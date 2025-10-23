import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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
    const { question, agentId, userId, shareToken, isShared, sessionId } = await req.json();

    if (!question) {
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

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get agent information
    let agent;
    if (sessionId) {
      // For follow-up questions, get agent from existing session
      const { data: existingSession, error: sessionError } = await supabase
        .from('qa_sessions')
        .select('agent_id')
        .eq('id', sessionId)
        .single();

      if (sessionError || !existingSession) {
        return new Response(
          JSON.stringify({ error: 'Session not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Get agent data
      const { data: agentData, error: agentError } = await supabase
        .from('agents')
        .select('*')
        .eq('id', existingSession.agent_id)
        .single();

      if (agentError || !agentData) {
        return new Response(
          JSON.stringify({ error: 'Agent not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      agent = agentData;
    } else if (isShared) {
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

    // Get active source for the agent
    const { data: sources, error: sourcesError } = await supabase
      .from('sources')
      .select('*')
      .eq('agent_id', agent.id)
      .eq('is_active', true);

    if (sourcesError || !sources || sources.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Nenhuma fonte ativa encontrada para este workspace' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Determine which specialized function to call based on source types
    const sourceTypes = sources.map(s => s.type);
    const isBigquery = sourceTypes.includes('bigquery');
    
    console.log('Routing to specialized function. BigQuery:', isBigquery);
    
    // Prepare payload for specialized function
    const payload = {
      question,
      agent,
      sources,
      sessionId,
      isShared,
      shareToken,
      userId
    };

    let targetFunction;
    if (isBigquery) {
      targetFunction = 'ask-question-bigquery';
    } else {
      targetFunction = 'ask-question-csv';
    }
    
    console.log(`Routing to: ${targetFunction}`);
    
    // Call the appropriate specialized function
    const functionResponse = await supabase.functions.invoke(targetFunction, {
      body: payload
    });

    if (functionResponse.error) {
      console.error(`Error calling ${targetFunction}:`, functionResponse.error);
      throw new Error(`Error in ${targetFunction}: ${functionResponse.error.message}`);
    }

    // Return the response from the specialized function
    return new Response(
      JSON.stringify(functionResponse.data),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in ask-question router function:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Erro interno do servidor' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});