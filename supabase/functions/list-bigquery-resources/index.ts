import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ListResourcesRequest {
  action: 'projects' | 'datasets' | 'tables';
  credentials?: string;
  supabaseStoragePath?: string;
  credentialsContent?: string;
  existingSourceId?: string;
  projectId?: string;
  datasetId?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from auth token
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const requestData: ListResourcesRequest = await req.json();
    const { action, credentials, supabaseStoragePath, credentialsContent, existingSourceId, projectId, datasetId } = requestData;

    console.log('List resources request:', { action, hasCredentials: !!credentials, supabaseStoragePath, hasCredentialsContent: !!credentialsContent, existingSourceId, projectId, datasetId });

    // Get credentials from various sources
    let credentialsJson = '';
    
    if (credentials) {
      // Direct credentials provided
      credentialsJson = credentials;
    } else if (credentialsContent) {
      // Credentials content from metadata
      credentialsJson = credentialsContent;
    } else if (supabaseStoragePath) {
      // Download from Supabase Storage
      const { data: fileData, error: downloadError } = await supabase.storage
        .from('data-files')
        .download(supabaseStoragePath);
      
      if (downloadError) {
        console.error('Error downloading credentials from storage:', downloadError);
        throw new Error('Failed to download credentials from storage');
      }
      
      credentialsJson = await fileData.text();
    } else if (existingSourceId) {
      // Query existing sources table
      const { data: source, error: sourceError } = await supabase
        .from('sources')
        .select('metadata')
        .eq('id', existingSourceId)
        .single();
      
      if (sourceError) throw sourceError;
      
      if (source?.metadata?.credentials_content) {
        credentialsJson = source.metadata.credentials_content;
      } else if (source?.metadata?.supabase_storage_path) {
        const { data: fileData, error: downloadError } = await supabase.storage
          .from('data-files')
          .download(source.metadata.supabase_storage_path);
        
        if (downloadError) throw downloadError;
        credentialsJson = await fileData.text();
      }
    }

    if (!credentialsJson) {
      throw new Error('No credentials provided');
    }

    // Parse credentials
    const credentialsObj = JSON.parse(credentialsJson);
    
    // Create JWT for authentication
    const accessToken = await createJWT(credentialsObj);

    let response;

    switch (action) {
      case 'projects':
        response = await listProjects(accessToken);
        break;
      case 'datasets':
        if (!projectId) throw new Error('projectId is required for listing datasets');
        response = await listDatasets(accessToken, projectId);
        break;
      case 'tables':
        if (!projectId || !datasetId) throw new Error('projectId and datasetId are required for listing tables');
        response = await listTables(accessToken, projectId, datasetId);
        break;
      default:
        throw new Error('Invalid action');
    }

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Error in list-bigquery-resources:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

async function listProjects(accessToken: string) {
  console.log('Listing BigQuery projects...');
  
  const response = await fetch(
    'https://cloudresourcemanager.googleapis.com/v1/projects',
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Error listing projects:', errorText);
    throw new Error(`Failed to list projects: ${response.statusText}`);
  }

  const data = await response.json();
  const projects = (data.projects || []).map((project: any) => ({
    id: project.projectId,
    name: project.name || project.projectId,
  }));

  console.log(`Found ${projects.length} projects`);
  return { projects };
}

async function listDatasets(accessToken: string, projectId: string) {
  console.log(`Listing datasets for project: ${projectId}`);
  
  const response = await fetch(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/datasets`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Error listing datasets:', errorText);
    throw new Error(`Failed to list datasets: ${response.statusText}`);
  }

  const data = await response.json();
  const datasets = (data.datasets || []).map((dataset: any) => ({
    id: dataset.datasetReference.datasetId,
    name: dataset.friendlyName || dataset.datasetReference.datasetId,
  }));

  console.log(`Found ${datasets.length} datasets`);
  return { datasets };
}

async function listTables(accessToken: string, projectId: string, datasetId: string) {
  console.log(`Listing tables for project: ${projectId}, dataset: ${datasetId}`);
  
  const response = await fetch(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/datasets/${datasetId}/tables`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Error listing tables:', errorText);
    throw new Error(`Failed to list tables: ${response.statusText}`);
  }

  const data = await response.json();
  const tables = (data.tables || []).map((table: any) => ({
    id: table.tableReference.tableId,
    name: table.friendlyName || table.tableReference.tableId,
    type: table.type,
  }));

  console.log(`Found ${tables.length} tables`);
  return { tables };
}

async function createJWT(credentials: any): Promise<string> {
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    kid: credentials.private_key_id
  };

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: credentials.client_email,
    sub: credentials.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/cloud-platform.read-only'
  };

  const encoder = new TextEncoder();
  const headerB64 = btoa(String.fromCharCode(...encoder.encode(JSON.stringify(header))))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const payloadB64 = btoa(String.fromCharCode(...encoder.encode(JSON.stringify(payload))))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const signatureInput = `${headerB64}.${payloadB64}`;
  const privateKey = await pemToBinary(credentials.private_key);

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    privateKey,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    encoder.encode(signatureInput)
  );

  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const jwt = `${signatureInput}.${signatureB64}`;

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    console.error('Token error:', errorText);
    throw new Error('Failed to get access token');
  }

  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}

async function pemToBinary(pem: string): Promise<ArrayBuffer> {
  const pemContent = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');

  const binaryString = atob(pemContent);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}
