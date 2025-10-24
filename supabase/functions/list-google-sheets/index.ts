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
    const authHeader = req.headers.get('Authorization')!;
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      throw new Error('Unauthorized');
    }

    const { spreadsheetId } = await req.json();
    console.log('Listing Google Sheets data for ID:', spreadsheetId);

    if (!spreadsheetId) {
      throw new Error('Spreadsheet ID is required');
    }

    // Get service account credentials
    const serviceAccountJson = Deno.env.get('GOOGLE_SHEETS_SERVICE_ACCOUNT');
    if (!serviceAccountJson) {
      throw new Error('Google Sheets service account not configured');
    }

    const credentials = JSON.parse(serviceAccountJson);
    const accessToken = await getAccessToken(credentials);

    // Get spreadsheet metadata
    const metadataResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );

    if (!metadataResponse.ok) {
      const error = await metadataResponse.text();
      console.error('Error fetching spreadsheet metadata:', error);
      throw new Error('Failed to fetch spreadsheet metadata. Make sure the sheet is shared with the service account.');
    }

    const metadata = await metadataResponse.json();
    const sheets = metadata.sheets.map((sheet: any) => ({
      title: sheet.properties.title,
      sheetId: sheet.properties.sheetId,
      rowCount: sheet.properties.gridProperties.rowCount,
      columnCount: sheet.properties.gridProperties.columnCount,
    }));

    console.log('Successfully fetched sheets:', sheets);

    return new Response(
      JSON.stringify({ 
        spreadsheetId,
        spreadsheetTitle: metadata.properties.title,
        sheets 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in list-google-sheets:', error);
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
    const error = await response.text();
    console.error('Error getting access token:', error);
    throw new Error('Failed to get access token');
  }

  const data = await response.json();
  return data.access_token;
}

async function createJWT(credentials: any): Promise<string> {
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };

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
