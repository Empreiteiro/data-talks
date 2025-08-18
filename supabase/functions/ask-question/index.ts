import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://ooimkdueuozjfwadrkkh.supabase.co',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

    // Validate user authentication for non-shared requests
    let validatedUserId = userId;
    if (!isShared) {
      const authHeader = req.headers.get('authorization');
      if (!authHeader) {
        return new Response(
          JSON.stringify({ error: 'Authentication required for non-shared requests' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Set auth header for the client
      const supabaseAuth = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
          },
          global: {
            headers: {
              authorization: authHeader,
            },
          },
        }
      );
      
      // Verify the user exists and get their ID
      const { data: userData, error: userError } = await supabaseAuth.auth.getUser();
      if (userError || !userData.user) {
        return new Response(
          JSON.stringify({ error: 'Invalid authentication token' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      validatedUserId = userData.user.id;
    }

    // Initialize Supabase client with anon key for security
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    // Get agent information
    let agent;
    if (sessionId) {
      // For follow-up questions, get agent from existing session with security checks
      const { data: sessionData, error: sessionError } = await supabase
        .from('qa_sessions')
        .select('agent_id, user_id')
        .eq('id', sessionId)
        .single();

      if (sessionError || !sessionData) {
        return new Response(
          JSON.stringify({ error: 'Session not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Security check: verify session ownership for non-shared sessions
      if (!isShared && sessionData.user_id !== validatedUserId) {
        return new Response(
          JSON.stringify({ error: 'Access denied to this session' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Get agent data
      const { data: agentData, error: agentError } = await supabase
        .from('agents')
        .select('*')
        .eq('id', sessionData.agent_id)
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
      userId: validatedUserId
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
      body: payload,
      headers: {
        authorization: req.headers.get('authorization') || '',
      }
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