import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

    // Get access token with corrected JWT
    const accessToken = await getAccessToken(credentials);

    // Get spreadsheet metadata using Google Sheets API
    console.log('Fetching spreadsheet metadata...');
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
      throw new Error('Failed to fetch spreadsheet metadata. Make sure the sheet is shared with the service account: ' + credentials.client_email);
    }

    const metadata = await metadataResponse.json();
    
    if (!metadata.sheets || metadata.sheets.length === 0) {
      throw new Error('No sheets found in spreadsheet. Make sure the spreadsheet ID is correct.');
    }

    const sheets = metadata.sheets.map((sheet: any) => ({
      title: sheet.properties.title,
      sheetId: sheet.properties.sheetId,
      rowCount: sheet.properties.gridProperties?.rowCount || 0,
      columnCount: sheet.properties.gridProperties?.columnCount || 0,
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
    
    let errorMessage = error.message || 'Erro desconhecido ao acessar a planilha';
    let userFriendlyMessage = errorMessage;
    
    // Get service account email for error messages
    const serviceAccountEmail = JSON.parse(Deno.env.get('GOOGLE_SHEETS_SERVICE_ACCOUNT') || '{}').client_email || 'conta de serviço';
    
    // Provide helpful error messages based on error type
    if (errorMessage.includes('permission') || errorMessage.includes('403') || errorMessage.includes('denied')) {
      userFriendlyMessage = `Acesso negado. A planilha precisa ser compartilhada com a conta de serviço: ${serviceAccountEmail}. Abra a planilha no Google Sheets e compartilhe com este e-mail dando permissão de visualização.`;
    } else if (errorMessage.includes('404') || errorMessage.includes('not found')) {
      userFriendlyMessage = 'Planilha não encontrada. Verifique se o ID da planilha está correto e se ela não foi excluída.';
    } else if (errorMessage.includes('Invalid spreadsheet ID format')) {
      userFriendlyMessage = 'Formato de ID de planilha inválido. O ID deve ter pelo menos 40 caracteres e pode ser encontrado na URL da planilha.';
    } else if (errorMessage.includes('Failed to get access token')) {
      userFriendlyMessage = 'Erro de autenticação com o Google. Verifique se as credenciais da conta de serviço estão configuradas corretamente.';
    } else if (errorMessage.includes('No sheets found')) {
      userFriendlyMessage = 'Nenhuma aba encontrada na planilha. Verifique se a planilha contém pelo menos uma aba.';
    }
    
    return new Response(
      JSON.stringify({ 
        error: userFriendlyMessage,
        details: errorMessage,
        serviceAccount: serviceAccountEmail
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

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
