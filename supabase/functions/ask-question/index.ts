import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const langflowApiKey = Deno.env.get('LANGFLOW_API_KEY');
const langflowBaseUrl = Deno.env.get('LANGFLOW_BASE_URL');
const langflowCsvFlowId = Deno.env.get('LANGFLOW_CSV_FLOW_ID');
const langflowBigqueryApiKey = Deno.env.get('LANGFLOW_BIGQUERY_API_KEY');
const langflowBigqueryUrl = Deno.env.get('LANGFLOW_BIGQUERY_URL');
const langflowBigqueryFlowId = Deno.env.get('LANGFLOW_BIGQUERY_FLOW_ID');
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { question, agentId, userId, shareToken, isShared } = await req.json();

    if (!question || !agentId) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // For shared agents, validate share token instead of userId
    if (isShared && !shareToken) {
      return new Response(
        JSON.stringify({ error: 'Share token required for shared agents' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!isShared && !userId) {
      return new Response(
        JSON.stringify({ error: 'User ID required for authenticated requests' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const startTime = Date.now();
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get agent information
    let agent;
    if (isShared) {
      // For shared agents, verify the share token
      const { data: sharedAgent, error: sharedError } = await supabase
        .rpc('get_shared_agent_safe_fields', { token_value: shareToken });
      
      if (sharedError || !sharedAgent?.[0]) {
        return new Response(
          JSON.stringify({ error: 'Invalid share token or agent not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      agent = sharedAgent[0];
    } else {
      // For authenticated users
      const { data: agentData, error: agentError } = await supabase
        .from('agents')
        .select('*')
        .eq('id', agentId)
        .single();

      if (agentError || !agentData) {
        return new Response(
          JSON.stringify({ error: 'Agent not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      agent = agentData;
    }

    // Get source information to determine agent type
    const { data: sources, error: sourcesError } = await supabase
      .from('sources')
      .select('*')
      .in('id', agent.source_ids);

    if (sourcesError) {
      return new Response(
        JSON.stringify({ error: 'Error fetching sources' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Determine which Langflow flow to use based on source types
    const sourceTypes = sources.map(s => s.type);
    const isBigquery = sourceTypes.includes('bigquery');
    
    let langflowData;
    
    if (isBigquery) {
      // Handle BigQuery flow
      if (!langflowBigqueryApiKey || !langflowBigqueryUrl || !langflowBigqueryFlowId) {
        return new Response(
          JSON.stringify({ error: 'Langflow BigQuery configuration not complete' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Get BigQuery source metadata
      const bigquerySource = sources.find(s => s.type === 'bigquery');
      if (!bigquerySource || !bigquerySource.metadata) {
        return new Response(
          JSON.stringify({ error: 'BigQuery source metadata not found' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const metadata = bigquerySource.metadata;
      const sessionId = crypto.randomUUID();
      
      // Build payload based on the Python script structure
      const payload = {
        output_type: "chat",
        input_type: "chat", 
        input_value: question,
        session_id: sessionId,
        tweaks: {
          "Prompt-7HDgb": {
            Schema: metadata.schema || metadata.columns?.join(' ') || '',
            table: metadata.table || '',
            project: metadata.project || '',
            dataset: metadata.dataset || ''
          },
          "BigQueryExecutor-7eyUr": {
            service_account_json_file: metadata.service_account_json_file || metadata.credentials_file || ''
          }
        }
      };

      console.log('BigQuery payload:', JSON.stringify(payload, null, 2));
      
      const langflowResponse = await fetch(`${langflowBigqueryUrl}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': langflowBigqueryApiKey
        },
        body: JSON.stringify(payload),
      });
      
      langflowData = await langflowResponse.json();
      
      if (!langflowResponse.ok) {
        console.error('Langflow BigQuery API error:', langflowData);
        throw new Error('Erro na API do Langflow BigQuery');
      }
    } else {
      // Handle CSV flow with file upload
      if (!langflowApiKey || !langflowBaseUrl || !langflowCsvFlowId) {
        return new Response(
          JSON.stringify({ error: 'Langflow CSV configuration not complete' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const headers = { 'x-api-key': langflowApiKey };
      
      // Get CSV sources and use existing Langflow paths
      const csvSources = sources.filter(s => s.type === 'csv');
      const langflowPaths = [];
      
      // Use existing Langflow paths instead of uploading again
      for (const csvSource of csvSources) {
        const langflowPath = csvSource.langflow_path;
        if (langflowPath) {
          langflowPaths.push(langflowPath);
          console.log('Using existing Langflow path:', langflowPath);
        } else {
          console.warn('No Langflow path found for source:', csvSource.name);
        }
      }
      
      // Generate session ID
      const sessionId = crypto.randomUUID();
      
      // Execute CSV flow
      const payload = {
        output_type: 'chat',
        input_type: 'text',
        input_value: question,
        session_id: sessionId,
        tweaks: {
          'File-6hxDL': {
            path: langflowPaths[0]
          },
          'File-7G3zO': {
            path: langflowPaths[0]
          },
          'Prompt Template-xmZAC': {
            description: agent.description || '',
            question: question
          }
        }
      };
      
      const langflowResponse = await fetch(`${langflowBaseUrl}/api/v1/run/${langflowCsvFlowId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: JSON.stringify(payload),
      });
      
      langflowData = await langflowResponse.json();
      
      if (!langflowResponse.ok) {
        console.error('Langflow CSV API error:', langflowData);
        throw new Error('Erro na API do Langflow CSV');
      }
    }

    const answer = langflowData.outputs?.[0]?.outputs?.[0]?.results?.message?.text || 'Resposta não disponível';
    const imageUrl = langflowData.outputs?.[0]?.outputs?.[0]?.results?.image_url || null;
    const latency = Date.now() - startTime;

    // Save QA session to database
    const { data: qaSession, error: qaError } = await supabase
      .from('qa_sessions')
      .insert({
        user_id: isShared ? null : userId, // For shared agents, user_id can be null
        agent_id: agentId,
        question,
        answer,
        latency,
        table_data: imageUrl ? { image_url: imageUrl } : null,
        status: 'completed',
        is_shared: isShared || false
      })
      .select()
      .single();

    if (qaError) {
      console.error('Error saving QA session:', qaError);
    }

    return new Response(
      JSON.stringify({
        answer,
        imageUrl,
        latency,
        sessionId: qaSession?.id
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in ask-question function:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Erro interno do servidor' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});