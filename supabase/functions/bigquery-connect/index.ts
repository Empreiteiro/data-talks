import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface BigQueryRequest {
  credentials: string; // JSON string of service account
  projectId: string;
  datasetId: string;
  tables: string[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')!
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    // Get user from token
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { credentials, projectId, datasetId, tables } = await req.json() as BigQueryRequest

    // Parse credentials
    let credentialsObj
    try {
      credentialsObj = JSON.parse(credentials)
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid credentials JSON' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Test BigQuery connection by listing tables
    const bigQueryUrl = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/datasets/${datasetId}/tables`
    
    // Get access token using service account credentials
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: await createJWT(credentialsObj)
      })
    })

    if (!tokenResponse.ok) {
      return new Response(JSON.stringify({ error: 'Failed to authenticate with Google' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { access_token } = await tokenResponse.json()

    // Test connection by fetching table list
    const tablesResponse = await fetch(bigQueryUrl, {
      headers: { 'Authorization': `Bearer ${access_token}` }
    })

    if (!tablesResponse.ok) {
      return new Response(JSON.stringify({ error: 'Failed to connect to BigQuery' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const tablesData = await tablesResponse.json()
    const availableTables = tablesData.tables?.map((t: any) => t.tableReference.tableId) || []

    // Validate requested tables exist
    const invalidTables = tables.filter(table => !availableTables.includes(table))
    if (invalidTables.length > 0) {
      return new Response(JSON.stringify({ 
        error: `Tables not found: ${invalidTables.join(', ')}`,
        availableTables 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Create source record in database
    const { data: source, error: sourceError } = await supabase
      .from('sources')
      .insert({
        user_id: user.id,
        name: `BigQuery: ${projectId}.${datasetId}`,
        type: 'bigquery',
        metadata: {
          project_id: projectId,
          dataset_id: datasetId,
          tables: tables,
          connection_tested: true,
          available_tables: availableTables
        }
      })
      .select()
      .single()

    if (sourceError) {
      throw sourceError
    }

    return new Response(JSON.stringify({ 
      success: true, 
      source,
      availableTables 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('BigQuery connection error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

async function createJWT(credentials: any): Promise<string> {
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    kid: credentials.private_key_id
  }

  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/bigquery.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  }

  const encoder = new TextEncoder()
  const headerB64 = btoa(JSON.stringify(header)).replace(/[+/]/g, char => char === '+' ? '-' : '_').replace(/=/g, '')
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/[+/]/g, char => char === '+' ? '-' : '_').replace(/=/g, '')
  
  const message = `${headerB64}.${payloadB64}`
  
  // Import private key
  const pemKey = credentials.private_key.replace(/\\n/g, '\n')
  const binaryKey = pemToBinary(pemKey)
  
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )

  // Sign the message
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    encoder.encode(message)
  )

  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/[+/]/g, char => char === '+' ? '-' : '_')
    .replace(/=/g, '')

  return `${message}.${signatureB64}`
}

function pemToBinary(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, '')
                 .replace(/-----END PRIVATE KEY-----/, '')
                 .replace(/\s/g, '')
  
  const binaryString = atob(b64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes.buffer
}