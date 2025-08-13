import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const langflowBigqueryEndpoint = Deno.env.get('LANGFLOW_BIGQUERY_ENDPOINT');
const langflowCsvEndpoint = Deno.env.get('LANGFLOW_CSV_ENDPOINT');
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
    const { question, agentId, userId } = await req.json();

    if (!question || !agentId || !userId) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const startTime = Date.now();
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get agent information
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('*')
      .eq('id', agentId)
      .single();

    if (agentError || !agent) {
      return new Response(
        JSON.stringify({ error: 'Agent not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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

    // Determine which Langflow endpoint to use based on source types
    const sourceTypes = sources.map(s => s.type);
    const isBigquery = sourceTypes.includes('bigquery');
    const endpoint = isBigquery ? langflowBigqueryEndpoint : langflowCsvEndpoint;

    if (!endpoint) {
      return new Response(
        JSON.stringify({ error: 'Langflow endpoint not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Send question to Langflow agent
    const langflowResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input_value: question,
        tweaks: {}
      }),
    });

    const langflowData = await langflowResponse.json();
    
    if (!langflowResponse.ok) {
      console.error('Langflow API error:', langflowData);
      throw new Error('Erro na API do Langflow');
    }

    const answer = langflowData.outputs?.[0]?.outputs?.[0]?.results?.message?.text || 'Resposta não disponível';
    const imageUrl = langflowData.outputs?.[0]?.outputs?.[0]?.results?.image_url || null;
    const latency = Date.now() - startTime;

    // Save QA session to database
    const { data: qaSession, error: qaError } = await supabase
      .from('qa_sessions')
      .insert({
        user_id: userId,
        agent_id: agentId,
        question,
        answer,
        latency,
        table_data: imageUrl ? { image_url: imageUrl } : null,
        status: 'completed'
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