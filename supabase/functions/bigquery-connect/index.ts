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

    const { credentials, projectId, datasetId, tables } = await req.json() as BigQueryRequest
    console.log('Request data:', { projectId, datasetId, tables: tables.length })

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

    // Simple connection test - just create source without validating tables for now
    console.log('Creating source record...')
    
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
          connection_tested: false, // Mark as not tested for now
          credentials_valid: true
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
      source,
      message: 'BigQuery source added successfully'
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