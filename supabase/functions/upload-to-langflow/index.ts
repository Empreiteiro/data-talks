import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface UploadResponse {
  path: string;
  name: string;
  supabaseStoragePath?: string;
  credentialsContent?: string;
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
    const authHeader = req.headers.get('Authorization')!;
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    // Get user from token
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      console.error('Auth error:', userError);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

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
    
    if (!file) {
      return new Response(
        JSON.stringify({ error: 'No file provided' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`Uploading file to Langflow: ${file.name}`);

    const fileContent = new Uint8Array(await file.arrayBuffer());
    const fileName = file.name;
    
    const result = await uploadFileToLangflow(
      fileContent,
      fileName,
      langflowApiKey,
      langflowBaseUrl
    );

    console.log('File uploaded successfully to Langflow:', result);

    // For JSON files (BigQuery credentials), also save to Supabase Storage
    let supabaseStoragePath: string | undefined;
    let credentialsContent: string | undefined;
    
    if (fileName.toLowerCase().endsWith('.json')) {
      try {
        console.log('Saving JSON file to Supabase Storage...');
        
        // Convert content to string for credentials
        const decoder = new TextDecoder();
        credentialsContent = decoder.decode(fileContent);
        
        // Save to Supabase Storage
        const storagePath = `${user.id}/${fileName}`;
        const { data: uploadData, error: uploadError } = await supabaseClient.storage
          .from('data-files')
          .upload(storagePath, fileContent, {
            contentType: 'application/json',
            upsert: true
          });

        if (uploadError) {
          console.error('Error uploading to Supabase Storage:', uploadError);
        } else {
          supabaseStoragePath = storagePath;
          console.log('File saved to Supabase Storage:', supabaseStoragePath);
        }
      } catch (storageError) {
        console.error('Error saving to storage:', storageError);
        // Continue even if storage fails
      }
    }

    return new Response(
      JSON.stringify({
        ...result,
        supabaseStoragePath,
        credentialsContent
      }),
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