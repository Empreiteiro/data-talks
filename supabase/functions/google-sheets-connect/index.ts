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

    const { spreadsheetId, spreadsheetTitle, sheetName, agentId } = await req.json();
    console.log('Connecting Google Sheet:', { spreadsheetId, sheetName, agentId });

    // Get service account credentials
    const serviceAccountJson = Deno.env.get('GOOGLE_SHEETS_SERVICE_ACCOUNT');
    if (!serviceAccountJson) {
      throw new Error('Google Sheets service account not configured');
    }

    const credentials = JSON.parse(serviceAccountJson);
    console.log('Service account email:', credentials.client_email);

    // Create Google Sheets client using official library
    const auth = ServiceAccount.fromJson(credentials);
    const sheets = new sheets_v4.Sheets(auth);

    // Fetch sheet data (first 100 rows for preview)
    const range = `${sheetName}!A1:Z100`;
    console.log('Fetching range:', range);
    
    const response = await sheets.spreadsheetsValuesGet({
      spreadsheetId: spreadsheetId,
      range: range,
    });

    const rows = response.values || [];
    
    if (rows.length === 0) {
      throw new Error('Sheet is empty');
    }

    // First row is headers
    const headers = rows[0];
    const previewRows = rows.slice(1, 11); // Preview first 10 data rows

    // Create schema
    const schema = headers.map((header: string, index: number) => ({
      name: header,
      type: inferColumnType(rows.slice(1).map((row: any[]) => row[index]))
    }));

    // Create source metadata
    const metadata = {
      spreadsheetId,
      spreadsheetTitle,
      sheetName,
      schema,
      preview: previewRows,
      totalRows: rows.length - 1,
      service_account_email: credentials.client_email
    };

    // Insert source into database
    const { data: source, error: insertError } = await supabaseClient
      .from('sources')
      .insert({
        user_id: user.id,
        agent_id: agentId,
        name: `${spreadsheetTitle} - ${sheetName}`,
        type: 'google_sheets',
        metadata,
        is_active: false,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error inserting source:', insertError);
      throw insertError;
    }

    console.log('Successfully created Google Sheets source:', source.id);

    return new Response(
      JSON.stringify({ success: true, source }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in google-sheets-connect:', error);
    
    let errorMessage = error.message || 'Unknown error';
    
    // Provide helpful error messages
    if (errorMessage.includes('permission') || errorMessage.includes('403')) {
      errorMessage = 'Access denied. Make sure the spreadsheet is shared with the service account: ' + 
        (JSON.parse(Deno.env.get('GOOGLE_SHEETS_SERVICE_ACCOUNT') || '{}').client_email || 'service account');
    } else if (errorMessage.includes('404')) {
      errorMessage = 'Spreadsheet not found. Please check the spreadsheet ID and make sure it exists.';
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

function inferColumnType(values: any[]): string {
  const nonEmptyValues = values.filter(v => v !== null && v !== undefined && v !== '');
  
  if (nonEmptyValues.length === 0) return 'text';
  
  const isNumber = nonEmptyValues.every(v => !isNaN(Number(v)));
  if (isNumber) return 'number';
  
  const isBoolean = nonEmptyValues.every(v => 
    v.toString().toLowerCase() === 'true' || 
    v.toString().toLowerCase() === 'false'
  );
  if (isBoolean) return 'boolean';
  
  return 'text';
}
