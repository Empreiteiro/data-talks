import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface UploadResponse {
  path: string;
  name: string;
}

function getMimeType(fileName: string): string {
  const extension = fileName.toLowerCase().split('.').pop() || '';
  
  const mimeTypes: Record<string, string> = {
    'pdf': 'application/pdf',
    'txt': 'text/plain',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'csv': 'text/csv',
    'json': 'application/json',
    'xml': 'application/xml',
    'html': 'text/html',
    'htm': 'text/html',
    'css': 'text/css',
    'js': 'application/javascript',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'bmp': 'image/bmp',
    'svg': 'image/svg+xml',
    'zip': 'application/zip',
    'rar': 'application/vnd.rar',
  };

  return mimeTypes[extension] || 'application/octet-stream';
}

async function uploadFileToLangflow(
  fileContent: Uint8Array,
  fileName: string,
  apiKey: string,
  langflowUrl: string
): Promise<UploadResponse> {
  const mimeType = getMimeType(fileName);
  const uploadUrl = `${langflowUrl}/api/v2/files`;

  const formData = new FormData();
  const blob = new Blob([fileContent], { type: mimeType });
  formData.append('file', blob, fileName);

  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'x-api-key': apiKey,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Langflow upload error:', errorText);
    throw new Error(`Failed to upload to Langflow: ${response.status} - ${errorText}`);
  }

  const responseJson = await response.json();
  
  if (!responseJson.path || !responseJson.name) {
    throw new Error('Response missing required keys "path" or "name"');
  }

  // Remove file extension from name
  const nameNoExt = responseJson.name.split('.').slice(0, -1).join('.');

  return {
    path: responseJson.path,
    name: nameNoExt,
  };
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const langflowApiKey = Deno.env.get('LANGFLOW_API_KEY');
    const langflowBaseUrl = Deno.env.get('LANGFLOW_BASE_URL');

    if (!langflowApiKey || !langflowBaseUrl) {
      console.error('Missing Langflow configuration');
      return new Response(
        JSON.stringify({ error: 'Langflow configuration missing' }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const formData = await req.formData();
    const file = formData.get('file') as File;
    const selectedSheet = formData.get('selectedSheet') as string;
    
    if (!file) {
      return new Response(
        JSON.stringify({ error: 'No file provided' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`Uploading file to Langflow: ${file.name}`, selectedSheet ? `(sheet: ${selectedSheet})` : '');

    let fileContent: Uint8Array;
    let fileName = file.name;

    // If it's an Excel file with a selected sheet, convert to CSV
    const fileExt = file.name.split('.').pop()?.toLowerCase();
    if (['xlsx', 'xls'].includes(fileExt || '') && selectedSheet) {
      const XLSX = await import('https://esm.sh/xlsx@0.18.5');
      
      try {
        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        
        if (!workbook.Sheets[selectedSheet]) {
          throw new Error(`Sheet "${selectedSheet}" not found in file`);
        }
        
        const worksheet = workbook.Sheets[selectedSheet];
        const csvContent = XLSX.utils.sheet_to_csv(worksheet);
        
        // Convert to CSV file for Langflow
        fileContent = new TextEncoder().encode(csvContent);
        fileName = file.name.replace(/\.(xlsx|xls)$/i, `.csv`);
        
        console.log(`Converted Excel sheet "${selectedSheet}" to CSV for Langflow upload`);
      } catch (error) {
        console.error('Error converting Excel to CSV:', error);
        throw new Error(`Failed to convert Excel sheet to CSV: ${error.message}`);
      }
    } else {
      fileContent = new Uint8Array(await file.arrayBuffer());
    }
    
    const result = await uploadFileToLangflow(
      fileContent,
      fileName,
      langflowApiKey,
      langflowBaseUrl
    );

    console.log('File uploaded successfully:', result);

    return new Response(
      JSON.stringify(result),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error uploading to Langflow:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});