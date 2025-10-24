import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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
    const { spreadsheetId } = await req.json();
    console.log('Listing Google Sheets data for ID:', spreadsheetId);

    if (!spreadsheetId) {
      throw new Error('Spreadsheet ID is required');
    }

    // Validate spreadsheet ID format
    if (!/^[a-zA-Z0-9-_]{40,}$/.test(spreadsheetId)) {
      throw new Error('Invalid spreadsheet ID format. Please check the URL and try again.');
    }

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

    // Get spreadsheet metadata
    console.log('Fetching spreadsheet metadata...');
    const response = await sheets.spreadsheetsGet({
      spreadsheetId: spreadsheetId,
    });

    if (!response.sheets || response.sheets.length === 0) {
      throw new Error('No sheets found in spreadsheet. Make sure the spreadsheet ID is correct.');
    }

    const sheetsList = response.sheets.map((sheet: any) => ({
      title: sheet.properties.title,
      sheetId: sheet.properties.sheetId,
      rowCount: sheet.properties.gridProperties?.rowCount || 0,
      columnCount: sheet.properties.gridProperties?.columnCount || 0,
    }));

    console.log('Successfully fetched sheets:', sheetsList);

    return new Response(
      JSON.stringify({ 
        spreadsheetId,
        spreadsheetTitle: response.properties?.title || 'Untitled Spreadsheet',
        sheets: sheetsList
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in list-google-sheets:', error);
    
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
