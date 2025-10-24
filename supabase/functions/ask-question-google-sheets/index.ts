import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { question, sources, agentInstructions } = await req.json();
    console.log('Processing Google Sheets question:', question);

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    if (!sources || sources.length === 0) {
      throw new Error('No Google Sheets sources provided');
    }

    const source = sources[0];
    const metadata = source.metadata;

    // Get service account credentials
    const serviceAccountJson = Deno.env.get('GOOGLE_SHEETS_SERVICE_ACCOUNT');
    if (!serviceAccountJson) {
      throw new Error('Google Sheets service account not configured');
    }

    const credentials = JSON.parse(serviceAccountJson);
    const accessToken = await getAccessToken(credentials);

    // Fetch all data from the sheet
    const range = `${metadata.sheetName}!A1:Z`;
    const dataResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${metadata.spreadsheetId}/values/${encodeURIComponent(range)}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );

    if (!dataResponse.ok) {
      throw new Error('Failed to fetch sheet data');
    }

    const data = await dataResponse.json();
    const rows = data.values || [];
    const headers = rows[0];
    const dataRows = rows.slice(1);

    // Convert to structured data
    const structuredData = dataRows.map((row: any[]) => {
      const obj: any = {};
      headers.forEach((header: string, index: number) => {
        obj[header] = row[index] || '';
      });
      return obj;
    });

    // Use Langflow to process the question
    const langflowApiKey = Deno.env.get('LANGFLOW_API_KEY');
    const langflowBaseUrl = Deno.env.get('LANGFLOW_BASE_URL');
    const langflowFlowId = Deno.env.get('LANGFLOW_CSV_FLOW_ID');

    if (!langflowApiKey || !langflowBaseUrl || !langflowFlowId) {
      throw new Error('Langflow configuration missing');
    }

    const langflowResponse = await fetch(`${langflowBaseUrl}/api/v1/run/${langflowFlowId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${langflowApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input_value: question,
        output_type: 'chat',
        input_type: 'chat',
        tweaks: {
          'ChatInput-lwbTr': {},
          'Prompt-eS3AW': {
            context: JSON.stringify(structuredData),
            instructions: agentInstructions || 'Você é um assistente útil que responde perguntas sobre dados de planilhas.',
          },
          'ChatOutput-JuHVa': {},
          'OpenAIModel-m2Sdh': {},
        },
      }),
    });

    if (!langflowResponse.ok) {
      const error = await langflowResponse.text();
      console.error('Langflow error:', error);
      throw new Error('Failed to process question with Langflow');
    }

    const langflowData = await langflowResponse.json();
    const answer = langflowData.outputs[0].outputs[0].results.message.text;

    console.log('Successfully processed question');

    return new Response(
      JSON.stringify({ 
        answer,
        tableData: structuredData.slice(0, 10), // Return first 10 rows as preview
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in ask-question-google-sheets:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

async function getAccessToken(credentials: any): Promise<string> {
  const jwt = await createJWT(credentials);
  
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to get access token');
  }

  const data = await response.json();
  return data.access_token;
}

async function createJWT(credentials: any): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const encodedHeader = btoa(JSON.stringify(header));
  const encodedPayload = btoa(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  const privateKey = await pemToBinary(credentials.private_key);
  const key = await crypto.subtle.importKey(
    'pkcs8',
    privateKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsignedToken)
  );

  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return `${unsignedToken}.${encodedSignature}`;
}

async function pemToBinary(pem: string): Promise<ArrayBuffer> {
  const pemContents = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const binaryString = atob(pemContents);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}
