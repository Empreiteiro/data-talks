import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { question, agentId: reqAgentId, userId, shareToken, isShared, sessionId } = await req.json();
    let resolvedAgentId = reqAgentId;

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

    const authHeader = req.headers.get('authorization') || '';

    // Validate user authentication for non-shared requests
    let validatedUserId = userId;
    if (!isShared) {
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
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { authorization: authHeader } },
      }
    );

    // Get agent information
    let agentData;
    let sourceData;
    
    if (sessionId) {
      // If sessionId is provided, get agent from existing session with security checks
      const { data: sessionData, error: sessionError } = await supabase
        .from('qa_sessions')
        .select(`
          agent_id,
          user_id,
          agents (
            id, name, description, source_ids
          )
        `)
        .eq('id', sessionId)
        .single();
      
      if (sessionError || !sessionData) {
        console.error('Session not found:', sessionError);
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
      
      agentData = sessionData.agents;
      resolvedAgentId = agentData.id;
    } else if (shareToken) {
      // Get agent by share token for shared agents
      const { data: sharedAgent, error: agentError } = await supabase
        .rpc('get_shared_agent_safe_fields', { token_value: shareToken });
      
      if (agentError || !sharedAgent || sharedAgent.length === 0) {
        console.error('Shared agent not found:', agentError);
        return new Response(
          JSON.stringify({ error: 'Shared agent not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      agentData = sharedAgent[0];
      resolvedAgentId = agentData.id;
      
      // Get agent's source_ids - we need a separate query for this
      const { data: fullAgentData, error: fullAgentError } = await supabase
        .from('agents')
        .select('source_ids')
         .eq('id', resolvedAgentId)
        .single();
      
      if (fullAgentError) {
        console.error('Error getting agent source_ids:', fullAgentError);
        return new Response(
          JSON.stringify({ error: 'Error retrieving agent data' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      agentData.source_ids = fullAgentData.source_ids;
    } else if (agentId && validatedUserId) {
      // Get agent by ID for authenticated users
      const { data: userAgent, error: agentError } = await supabase
        .from('agents')
        .select('id, name, description, source_ids')
        .eq('id', resolvedAgentId)
        .eq('user_id', validatedUserId)
        .single();
      
      if (agentError || !userAgent) {
        console.error('Agent not found or access denied:', agentError);
        return new Response(
          JSON.stringify({ error: 'Agent not found or access denied' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      agentData = userAgent;
    } else {
      return new Response(
        JSON.stringify({ error: 'Insufficient parameters to identify agent' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get source information to determine agent type
    const { data: sources, error: sourcesError } = await supabase
      .from('sources')
      .select('*')
      .in('id', agentData.source_ids);

    if (sourcesError) {
      return new Response(
        JSON.stringify({ error: 'Error fetching sources' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Determine which processing logic to use based on source types
    const sourceTypes = sources.map(s => s.type);
    const isBigquery = sourceTypes.includes('bigquery');
    const isCSV = sourceTypes.includes('csv');
    
    console.log('Processing question with sources:', sourceTypes);
    
    const startTime = Date.now();
    let answer = 'Resposta não disponível';
    let imageUrl: string | null = null;
    let followUpQuestions: string[] = [];

    // Process based on source type
    if (isBigquery) {
      // BigQuery Processing
      const langflowBigqueryApiKey = Deno.env.get('LANGFLOW_BIGQUERY_API_KEY');
      const langflowBigqueryUrl = Deno.env.get('LANGFLOW_BIGQUERY_URL');
      const langflowBigqueryFlowId = Deno.env.get('LANGFLOW_BIGQUERY_FLOW_ID');
      
      if (!langflowBigqueryApiKey || !langflowBigqueryUrl || !langflowBigqueryFlowId) {
        return new Response(
          JSON.stringify({ error: 'Langflow BigQuery configuration not complete' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const bigquerySource = sources.find(s => s.type === 'bigquery');
      if (!bigquerySource) {
        return new Response(
          JSON.stringify({ error: 'BigQuery source not found' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const metadata = bigquerySource.metadata || {};
      const credentialsPath = bigquerySource.langflow_path || '';
      
      if (!credentialsPath) {
        return new Response(
          JSON.stringify({ error: 'BigQuery credentials file not configured' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Build schema from table_infos
      let schemaText = "";
      if (metadata.table_infos && Array.isArray(metadata.table_infos)) {
        schemaText = metadata.table_infos.map((tableInfo: any) => {
          const tableName = tableInfo.table_name || "";
          const columns = tableInfo.columns || [];
          return `Tabela: ${tableName}\nColunas: ${columns.join(', ')}`;
        }).join('\n\n');
      }
      
      const langflowSessionId = crypto.randomUUID();
      
      const payload = {
        output_type: "chat",
        input_type: "text",
        input_value: question,
        session_id: langflowSessionId,
        tweaks: {
          "Prompt-7HDgb": {
            Schema: schemaText,
            table: metadata.table || "",
            project: metadata.project || metadata.project_id || "",
            dataset: metadata.dataset || metadata.dataset_id || ""
          },
          "File-lER3y": {
            path: [credentialsPath]
          },
          "Prompt Template-RF5j9": {
            question: question,
            schema: schemaText
          }
        }
      };

      const langflowApiUrl = `${langflowBigqueryUrl.replace(/\/$/, '')}/api/v1/run/${langflowBigqueryFlowId}`;
      const headers = { 'x-api-key': langflowBigqueryApiKey };
      
      const langflowResponse = await fetch(langflowApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: JSON.stringify(payload),
      });
      
      if (!langflowResponse.ok) {
        const errorData = await langflowResponse.json();
        console.error('Langflow BigQuery API error:', errorData);
        throw new Error(`Erro na API do Langflow BigQuery: ${langflowResponse.status}`);
      }

      const langflowData = await langflowResponse.json();
      
      if (langflowData.outputs?.[0]?.outputs) {
        const outputs = langflowData.outputs[0].outputs;
        
        for (const output of outputs) {
          if (output.results) {
            // Check for base64 image data
            if (output.results.base64 || (typeof output.results.message === 'string' && output.results.message.startsWith('data:image'))) {
              const base64Data = output.results.base64 || output.results.message;
              if (base64Data && !base64Data.startsWith('data:')) {
                imageUrl = `data:image/png;base64,${base64Data}`;
              } else {
                imageUrl = base64Data;
              }
            }
            
            // Check for text response
            if (output.results.message?.text) {
              answer = output.results.message.text;
            } else if (typeof output.results.message === 'string' && !output.results.message.startsWith('data:image')) {
              answer = output.results.message;
            }
          }
        }
      }
    } else if (isCSV) {
      // CSV Processing
      const langflowApiKey = Deno.env.get('LANGFLOW_API_KEY');
      const langflowBaseUrl = Deno.env.get('LANGFLOW_BASE_URL');
      const langflowCsvFlowId = Deno.env.get('LANGFLOW_CSV_FLOW_ID');
      
      if (!langflowApiKey || !langflowBaseUrl || !langflowCsvFlowId) {
        return new Response(
          JSON.stringify({ error: 'Langflow CSV configuration not complete' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const csvSources = sources.filter(s => s.type === 'csv');
      const langflowPaths: string[] = [];
      let csvSchema = "";
      
      for (const csvSource of csvSources) {
        const langflowPath = csvSource.langflow_path;
        if (langflowPath) {
          langflowPaths.push(langflowPath);
        }
        
        if (csvSource.metadata && csvSource.metadata.columns) {
          const columns = Array.isArray(csvSource.metadata.columns) 
            ? csvSource.metadata.columns.join(', ')
            : csvSource.metadata.columns;
          csvSchema += `Arquivo: ${csvSource.name}\nColunas: ${columns}\n\n`;
        }
      }
      
      if (langflowPaths.length === 0) {
        return new Response(
          JSON.stringify({ error: 'Nenhum arquivo CSV encontrado' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      const langflowSessionId = crypto.randomUUID();
      
      const payload = {
        output_type: 'chat',
        input_type: 'text',
        input_value: question,
        session_id: langflowSessionId,
        tweaks: {
          'File-6hxDL': { path: [langflowPaths[0]] },
          'File-eHrha': { path: [langflowPaths[0]] },
          'Prompt Template-xmZAC': {
            description: agentData.description || '',
            question: question,
            file_path: langflowPaths[0] || '',
            schema: csvSchema
          }
        }
      };
      
      const headers = { 'x-api-key': langflowApiKey };
      
      const langflowResponse = await fetch(`${langflowBaseUrl}/api/v1/run/${langflowCsvFlowId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: JSON.stringify(payload),
      });
      
      if (!langflowResponse.ok) {
        const errorData = await langflowResponse.json();
        console.error('Langflow CSV API error:', errorData);
        throw new Error(`Erro na API do Langflow CSV: ${langflowResponse.status}`);
      }

      const langflowData = await langflowResponse.json();
      const outputs = langflowData.outputs?.[0]?.outputs || [];
      
      answer = outputs[0]?.results?.message?.text || 'Resposta não disponível';
      imageUrl = outputs[0]?.results?.image_url || null;
      
      if (outputs[1]?.results?.message?.text) {
        const questionsText = outputs[1].results.message.text;
        followUpQuestions = questionsText
          .split('\n')
          .filter((line: string) => line.trim() && line.includes('?'))
          .map((q: string) => q.replace(/^\d+\.\s*/, '').trim());
      }
    }
    
    const latency = Date.now() - startTime;

    // Create or get QA session with proper security checks
    let qaSession: any;
    if (sessionId) {
      // Get existing session with security validation
      const { data: existingSession, error: sessionError } = await supabase
        .from('qa_sessions')
        .select('*')
        .eq('id', sessionId)
        .eq('agent_id', agentData.id)
        .single();

      if (sessionError || !existingSession) {
        console.error('Error finding existing session:', sessionError);
        throw new Error('Failed to find existing session');
      }
      
      // Security check for non-shared sessions
      if (!isShared && existingSession.user_id !== validatedUserId) {
        throw new Error('Access denied to this session');
      }
      
      qaSession = existingSession;
    } else if (isShared) {
      // For shared questions, create session with agent_id and share_token
      const { data: sessionData, error: sessionError } = await supabase
        .from('qa_sessions')
        .insert({
          question,
          agent_id: agentData.id,
          share_token: shareToken,
          is_shared: true
        })
        .select()
        .single();

      if (sessionError) {
        console.error('Error creating shared session:', sessionError);
        throw new Error('Failed to create shared session');
      }
      
      qaSession = sessionData;
    } else {
      // For regular questions, create session with validated user_id
      const { data: sessionData, error: sessionError } = await supabase
        .from('qa_sessions')
        .insert({
          question,
          user_id: validatedUserId,
          agent_id: agentData.id
        })
        .select()
        .single();

      if (sessionError) {
        console.error('Error creating session:', sessionError);
        throw new Error('Failed to create session');
      }
      
      qaSession = sessionData;
    }

    // Update the session with the response
    if (sessionId) {
      // For follow-up questions, append to conversation history
      const conversationEntry = {
        question,
        answer,
        imageUrl,
        followUpQuestions,
        timestamp: new Date().toISOString()
      };
      
      const currentHistory = qaSession.conversation_history || [];
      const updatedHistory = [...currentHistory, conversationEntry];
      
      const { error: updateError } = await supabase
        .from('qa_sessions')
        .update({
          conversation_history: updatedHistory,
          latency,
          follow_up_questions: followUpQuestions
        })
        .eq('id', qaSession.id);
        
      if (updateError) {
        console.error('Error updating QA session:', updateError);
      }
    } else {
      // For initial questions, create initial conversation entry
      const initialEntry = {
        question,
        answer,
        imageUrl,
        followUpQuestions,
        timestamp: new Date().toISOString()
      };
      
      const { error: updateError } = await supabase
        .from('qa_sessions')
        .update({
          answer,
          table_data: imageUrl ? { image_url: imageUrl } : null,
          latency,
          follow_up_questions: followUpQuestions,
          conversation_history: [initialEntry]
        })
        .eq('id', qaSession.id);
        
      if (updateError) {
        console.error('Error updating QA session:', updateError);
      }
    }

    return new Response(
      JSON.stringify({
        answer,
        imageUrl,
        latency,
        sessionId: qaSession?.id,
        followUpQuestions
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in ask-question function:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message || 'Erro interno do servidor' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});