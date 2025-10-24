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

    const { spreadsheetId, spreadsheetTitle, sheetName, agentId } = await req.json();
    console.log('Connecting Google Sheet:', { spreadsheetId, sheetName, agentId });

    // Get service account credentials
    const serviceAccountJson = Deno.env.get('GOOGLE_SHEETS_SERVICE_ACCOUNT');
    if (!serviceAccountJson) {
      throw new Error('Google Sheets service account not configured');
    }

    const credentials = JSON.parse(serviceAccountJson);
    console.log('Service account email:', credentials.client_email);

    // Get access token with corrected JWT
    const accessToken = await getAccessToken(credentials);

    // Fetch sheet data (first 100 rows for preview)
    const range = `${sheetName}!A1:Z100`;
    console.log('Fetching range:', range);
    
    const dataResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );

    if (!dataResponse.ok) {
      const error = await dataResponse.text();
      console.error('Error fetching sheet data:', error);
      throw new Error('Failed to fetch sheet data. Make sure the sheet is shared with: ' + credentials.client_email);
    }

    const data = await dataResponse.json();
    const rows = data.values || [];
    
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

// Helper function to encode base64url (RFC 4648)
function base64UrlEncode(str: string): string {
  const base64 = btoa(str);
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

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
    throw new Error('Failed to get access token from Google');
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
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  // Use base64url encoding instead of regular base64
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
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

  // Encode signature as base64url
  const signatureArray = new Uint8Array(signature);
  const signatureStr = String.fromCharCode(...signatureArray);
  const encodedSignature = base64UrlEncode(signatureStr);
  
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
