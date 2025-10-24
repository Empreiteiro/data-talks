import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { ServiceAccount } from "https://googleapis.deno.dev/v1/serviceusage:v1.ts";
import { sheets_v4 } from "https://googleapis.deno.dev/v1/sheets:v4.ts";

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
    console.log('Fetching data with service account:', credentials.client_email);

    // Create Google Sheets client using official library
    const auth = ServiceAccount.fromJson(credentials);
    const sheets = new sheets_v4.Sheets(auth);

    // Fetch all data from the sheet
    const range = `${metadata.sheetName}!A1:Z`;
    console.log('Fetching range:', range);
    
    const response = await sheets.spreadsheetsValuesGet({
      spreadsheetId: metadata.spreadsheetId,
      range: range,
    });

    const rows = response.values || [];
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
    
    let errorMessage = error.message || 'Unknown error';
    
    // Provide helpful error messages
    if (errorMessage.includes('permission') || errorMessage.includes('403')) {
      errorMessage = 'Access denied. Make sure the spreadsheet is shared with the service account: ' + 
        (JSON.parse(Deno.env.get('GOOGLE_SHEETS_SERVICE_ACCOUNT') || '{}').client_email || 'service account');
    } else if (errorMessage.includes('404')) {
      errorMessage = 'Spreadsheet or sheet not found. Please verify the spreadsheet ID and sheet name.';
    }
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
