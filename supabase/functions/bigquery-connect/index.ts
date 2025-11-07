import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
  supabaseStoragePath?: string;
  credentialsContent?: string;
  agentId?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    console.log('=== BigQuery connection request started ===')
    
    const authHeader = req.headers.get('Authorization')!
    if (!authHeader) {
      console.error('No Authorization header found')
      return new Response(JSON.stringify({ error: 'Authorization header missing' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )
    
    // Create service role client for storage access
    const supabaseServiceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get user from token
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) {
      console.error('Auth error:', userError)
      return new Response(JSON.stringify({ error: 'Unauthorized: ' + (userError?.message || 'No user found') }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log('User authenticated:', user.id)

    // Parse request body with error handling
    let requestData: BigQueryRequest
    try {
      requestData = await req.json() as BigQueryRequest
    } catch (parseError) {
      console.error('Failed to parse request body:', parseError)
      return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { credentials, projectId, datasetId, tables, langflowPath, langflowName, supabaseStoragePath, credentialsContent, agentId } = requestData
    
    console.log('Request data received:', { 
      projectId, 
      datasetId, 
      tables: tables?.length || 0, 
      langflowPath, 
      langflowName, 
      supabaseStoragePath,
      hasCredentials: !!credentials,
      hasCredentialsContent: !!credentialsContent,
      agentId
    })

    // Validate required fields
    if (!projectId || !datasetId || !tables || tables.length === 0) {
      console.error('Missing required fields:', { projectId: !!projectId, datasetId: !!datasetId, tables: tables?.length || 0 })
      return new Response(JSON.stringify({ error: 'Missing required fields: projectId, datasetId, and tables are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Parse and validate credentials
    let credentialsObj
    let access_token
    
    // Check if we're reusing existing credentials (langflowPath exists and credentials is empty)
    const reusingCredentials = langflowPath && (!credentials || credentials.trim() === '')
    
    if (reusingCredentials) {
      // Reusing existing credentials
      console.log('Reusing credentials. StoragePath:', supabaseStoragePath, 'HasContent:', !!credentialsContent)
      
      try {
        // Priority 1: Use credentialsContent if provided (fastest)
        if (credentialsContent) {
          console.log('Using credentials from credentialsContent')
          credentialsObj = JSON.parse(credentialsContent)
        }
        // Priority 2: Use supabaseStoragePath if provided
        else if (supabaseStoragePath) {
          console.log('Loading credentials from Supabase Storage:', supabaseStoragePath)
          
          const { data: fileData, error: downloadError } = await supabaseServiceClient.storage
            .from('data-files')
            .download(supabaseStoragePath)
          
          if (downloadError) {
            console.error('Error downloading from storage:', downloadError)
            throw new Error('Falha ao recuperar credenciais do storage: ' + downloadError.message)
          }
          
          const fileText = await fileData.text()
          credentialsObj = JSON.parse(fileText)
          console.log('Credentials loaded from Supabase Storage')
        }
        // Priority 3: Fallback - search existing source
        else {
          console.log('Searching for existing source metadata')
          
          const { data: existingSource, error: sourceQueryError } = await supabaseClient
            .from('sources')
            .select('metadata')
            .eq('type', 'bigquery')
            .eq('langflow_path', langflowPath)
            .limit(1)
            .single()
          
          if (sourceQueryError || !existingSource) {
            console.error('Error finding existing source:', sourceQueryError)
            throw new Error('Nenhuma fonte encontrada com estas credenciais: ' + (sourceQueryError?.message || 'Source not found'))
          }
          
          const metadata = existingSource.metadata as any
          
          // Try credentialsContent from metadata first
          if (metadata?.credentials_content) {
            console.log('Using credentials_content from metadata')
            credentialsObj = JSON.parse(metadata.credentials_content)
          }
          // Then try storage path
          else if (metadata?.supabase_storage_path) {
            console.log('Using supabase_storage_path from metadata')
            
            const { data: fileData, error: downloadError } = await supabaseServiceClient.storage
              .from('data-files')
              .download(metadata.supabase_storage_path)
            
            if (downloadError) {
              console.error('Error downloading from storage:', downloadError)
              throw new Error('Falha ao recuperar credenciais do storage: ' + downloadError.message)
            }
            
            const fileText = await fileData.text()
            credentialsObj = JSON.parse(fileText)
          } else {
            throw new Error('Credenciais não encontradas nos metadados')
          }
        }
        
        console.log('Credentials loaded successfully')
      } catch (e) {
        console.error('Error loading credentials:', e.message)
        return new Response(JSON.stringify({ error: 'Falha ao carregar credenciais: ' + e.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    } else {
      // New credentials - need to parse and validate
      try {
        if (!credentials || credentials.trim() === '') {
          throw new Error('Credenciais não fornecidas')
        }
        
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
    }

    // Get access token using service account credentials (always needed for data preview)
    if (credentialsObj) {
      console.log('Getting access token...')
      try {
        const jwtToken = await createJWT(credentialsObj)
        console.log('JWT created successfully')
        
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwtToken
          })
        })

        if (!tokenResponse.ok) {
          const errorText = await tokenResponse.text()
          console.error('Token error response:', tokenResponse.status, errorText)
          return new Response(JSON.stringify({ error: 'Falha na autenticação com Google: ' + errorText }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }

        const tokenData = await tokenResponse.json()
        access_token = tokenData.access_token
        console.log('Access token obtained successfully')
      } catch (jwtError) {
        console.error('JWT creation error:', jwtError)
        return new Response(JSON.stringify({ error: 'Erro ao criar JWT: ' + jwtError.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    // Get table schemas and preview data
    const tableInfos = []
    const failedTables = []
    
    if (access_token) {
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
            console.error(`Failed to get schema for ${tableName}:`, schemaResponse.status, errorText)
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
          } else {
            const queryErrorText = await queryResponse.text()
            console.error(`Query failed for ${tableName}:`, queryResponse.status, queryErrorText)
            failedTables.push(`${tableName} (erro na consulta)`)
          }
        } catch (tableError) {
          console.error(`Error processing table ${tableName}:`, tableError)
          failedTables.push(`${tableName} (erro ao processar: ${tableError.message})`)
        }
      }
    }
    
    console.log('Creating source record...')
    console.log('Agent ID received:', agentId)
    
    // Se houver agentId, desativar outras fontes do agent antes de criar a nova
    if (agentId) {
      try {
        const { error: deactivateError } = await supabaseClient
          .from('sources')
          .update({ is_active: false })
          .eq('agent_id', agentId)
        
        if (deactivateError) {
          console.error('Error deactivating existing sources:', deactivateError)
          // Don't fail the whole operation, just log the error
        }
      } catch (deactivateError) {
        console.error('Error in deactivation process:', deactivateError)
      }
    }
    
    // Create the source record
    // Note: organization_id will be set automatically by the trigger
    const sourceData = {
      user_id: user.id,
      agent_id: agentId || null,
      name: `BigQuery: ${projectId}.${datasetId}.${tables[0]}`,
      type: 'bigquery',
      langflow_path: langflowPath || null,
      langflow_name: langflowName || null,
      is_active: agentId ? true : false,
      metadata: {
        project_id: projectId,
        dataset_id: datasetId,
        tables: tables,
        connection_tested: true,
        table_infos: tableInfos,
        total_tables: tableInfos.length,
        failed_tables: failedTables,
        supabase_storage_path: supabaseStoragePath || null,
        credentials_content: credentialsContent || null
      }
    }

    console.log('Inserting source with data:', JSON.stringify(sourceData, null, 2))
    
    const { data: source, error: sourceError } = await supabaseClient
      .from('sources')
      .insert(sourceData)
      .select()
      .single()

    if (sourceError) {
      console.error('Database error creating source:', sourceError)
      return new Response(JSON.stringify({ 
        error: 'Erro ao criar fonte no banco de dados: ' + sourceError.message,
        details: sourceError
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
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
    console.error('=== BigQuery connection error ===')
    console.error('Error type:', error.constructor.name)
    console.error('Error message:', error.message)
    console.error('Error stack:', error.stack)
    console.error('=== End error details ===')
    
    return new Response(JSON.stringify({ 
      error: error.message || 'Erro interno do servidor',
      details: error.toString(),
      type: error.constructor.name
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

async function createJWT(credentials: any): Promise<string> {
  try {
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
  } catch (jwtError) {
    console.error('JWT creation failed:', jwtError)
    throw new Error('Falha ao criar JWT: ' + jwtError.message)
  }
}

function pemToBinary(pem: string): ArrayBuffer {
  try {
    const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, '')
                   .replace(/-----END PRIVATE KEY-----/, '')
                   .replace(/\s/g, '')
    
    const binaryString = atob(b64)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    return bytes.buffer
  } catch (pemError) {
    console.error('PEM to binary conversion failed:', pemError)
    throw new Error('Falha ao processar chave privada: ' + pemError.message)
  }
}