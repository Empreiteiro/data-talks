import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface BigQueryRequest {
  credentials: string;
  projectId: string;
  datasetId: string;
  tables: string[];
  langflowPath?: string;
  langflowName?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    console.log('BigQuery connection request started')
    
    const authHeader = req.headers.get('Authorization')!
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    // Get user from token
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      console.error('Auth error:', userError)
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log('User authenticated:', user.id)

    const { credentials, projectId, datasetId, tables, langflowPath, langflowName } = await req.json() as BigQueryRequest
    console.log('Request data:', { projectId, datasetId, tables: tables.length, langflowPath, langflowName })

    // Parse and validate credentials
    let credentialsObj
    try {
      credentialsObj = JSON.parse(credentials)
      console.log('Credentials parsed successfully')
      
      if (!credentialsObj.client_email || !credentialsObj.private_key) {
        throw new Error('Credenciais inválidas: client_email ou private_key ausentes')
      }
    } catch (e) {
      console.error('Credentials parse error:', e.message)
      return new Response(JSON.stringify({ error: 'Credenciais JSON inválidas: ' + e.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Get access token using service account credentials
    console.log('Getting access token...')
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: await createJWT(credentialsObj)
      })
    })

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      console.error('Token error:', errorText)
      return new Response(JSON.stringify({ error: 'Falha na autenticação com Google: ' + errorText }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { access_token } = await tokenResponse.json()
    console.log('Access token obtained')

    // Get table schemas and preview data
    const tableInfos = []
    const failedTables = []
    
    for (const tableName of tables) {
      try {
        console.log(`Getting info for table: ${tableName}`)
        
        // Get table schema
        const schemaUrl = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/datasets/${datasetId}/tables/${tableName}`
        const schemaResponse = await fetch(schemaUrl, {
          headers: { 'Authorization': `Bearer ${access_token}` }
        })

        if (!schemaResponse.ok) {
          const errorText = await schemaResponse.text()
          console.error(`Failed to get schema for ${tableName}:`, errorText)
          failedTables.push(`${tableName} (não encontrada)`)
          continue
        }

        const schemaData = await schemaResponse.json()
        const columns = schemaData.schema?.fields?.map((field: any) => field.name) || []

        // Get preview data (first 5 rows)
        const queryUrl = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`
        const query = `SELECT * FROM \`${projectId}.${datasetId}.${tableName}\` LIMIT 5`
        
        const queryResponse = await fetch(queryUrl, {
          method: 'POST',
          headers: { 
            'Authorization': `Bearer ${access_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            query,
            useLegacySql: false
          })
        })

        if (queryResponse.ok) {
          const queryData = await queryResponse.json()
          const previewRows = queryData.rows?.map((row: any) => {
            const rowData: any = {}
            columns.forEach((col: string, idx: number) => {
              rowData[col] = row.f[idx]?.v || null
            })
            return rowData
          }) || []

          // Get total row count
          const countQuery = `SELECT COUNT(*) as total FROM \`${projectId}.${datasetId}.${tableName}\``
          const countResponse = await fetch(queryUrl, {
            method: 'POST',
            headers: { 
              'Authorization': `Bearer ${access_token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              query: countQuery,
              useLegacySql: false
            })
          })

          let rowCount = 0
          if (countResponse.ok) {
            const countData = await countResponse.json()
            rowCount = parseInt(countData.rows?.[0]?.f?.[0]?.v || '0')
          }

          tableInfos.push({
            table_name: tableName,
            columns,
            preview_rows: previewRows,
            row_count: rowCount
          })
        }
      } catch (tableError) {
        console.error(`Error processing table ${tableName}:`, tableError)
      }
    }
    
    console.log('Creating source record...')
    const { data: source, error: sourceError } = await supabase
      .from('sources')
      .insert({
        user_id: user.id,
        name: `BigQuery: ${projectId}.${datasetId}`,
        type: 'bigquery',
        langflow_path: langflowPath || null,
        langflow_name: langflowName || null,
        metadata: {
          project_id: projectId,
          dataset_id: datasetId,
          tables: tables,
          connection_tested: true,
          table_infos: tableInfos,
          total_tables: tableInfos.length,
          failed_tables: failedTables
        }
      })
      .select()
      .single()

    if (sourceError) {
      console.error('Database error:', sourceError)
      throw sourceError
    }

    console.log('Source created successfully:', source.id)

    return new Response(JSON.stringify({ 
      success: true,
      sourceId: source.id,
      source,
      tableInfos,
      message: 'BigQuery conectado com sucesso!'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('BigQuery connection error:', error)
    return new Response(JSON.stringify({ 
      error: error.message || 'Erro interno do servidor',
      details: error.toString()
    }), {
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