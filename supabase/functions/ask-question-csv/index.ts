import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const langflowApiKey = Deno.env.get('LANGFLOW_API_KEY');
const langflowBaseUrl = Deno.env.get('LANGFLOW_BASE_URL');
const langflowCsvFlowId = Deno.env.get('LANGFLOW_CSV_FLOW_ID');

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
    const body = await req.json();
    const { question, agent, sources, sessionId, isShared, shareToken, userId } = body;

    if (!question || !agent || !sources) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate CSV configuration
    if (!langflowApiKey || !langflowBaseUrl || !langflowCsvFlowId) {
      return new Response(
        JSON.stringify({ error: 'Langflow CSV configuration not complete' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
      
      // Create authenticated Supabase client to validate user
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

    const startTime = Date.now();
    
    // Create Supabase client with anon key for data operations
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );
    
    const headers = { 'x-api-key': langflowApiKey };
    
    // Get CSV sources and use existing Langflow paths
    const csvSources = sources.filter(s => s.type === 'csv');
    const langflowPaths = [];
    let csvSchema = "";
    
    // Use existing Langflow paths instead of uploading again
    for (const csvSource of csvSources) {
      const langflowPath = csvSource.langflow_path;
      if (langflowPath) {
        langflowPaths.push(langflowPath);
        console.log('Using existing Langflow path:', langflowPath);
      } else {
        console.warn('No Langflow path found for source:', csvSource.name);
      }
      
      // Extract schema from metadata if available
      if (csvSource.metadata && csvSource.metadata.columns) {
        const columns = Array.isArray(csvSource.metadata.columns) 
          ? csvSource.metadata.columns.join(', ')
          : csvSource.metadata.columns;
        csvSchema += `Arquivo: ${csvSource.name}\nColunas: ${columns}\n\n`;
      }
    }
    
    // Check if we have any valid paths
    if (langflowPaths.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Nenhum arquivo CSV encontrado ou configurado para este agente' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Generate session ID
    const langflowSessionId = crypto.randomUUID();
    
    // Execute CSV flow
    const payload = {
      output_type: 'chat',
      input_type: 'text',
      input_value: question,
      session_id: langflowSessionId,
      tweaks: {
        'File-6hxDL': {
          path: [langflowPaths[0]]
        },
        'File-eHrha': {
          path: [langflowPaths[0]]
        },
        'Prompt Template-xmZAC': {
          description: agent.description || '',
          question: question,
          file_path: langflowPaths[0] || '',
          schema: csvSchema
        }
      }
    };
    
    console.log('CSV Payload:', JSON.stringify(payload, null, 2));
    
    const langflowResponse = await fetch(`${langflowBaseUrl}/api/v1/run/${langflowCsvFlowId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify(payload),
    });
    
    const langflowData = await langflowResponse.json();
    console.log('Langflow CSV Response:', JSON.stringify(langflowData, null, 2));
    
    if (!langflowResponse.ok) {
      console.error('Langflow CSV API error:', langflowData);
      throw new Error('Erro na API do Langflow CSV');
    }

    // For CSV responses, extract main answer and follow-up questions
    const outputs = langflowData.outputs?.[0]?.outputs || [];
    
    // First output contains the main answer
    const answer = outputs[0]?.results?.message?.text || 'Resposta não disponível';
    const imageUrl = outputs[0]?.results?.image_url || null;
    
    // Second output contains follow-up questions (if available)
    let followUpQuestions = [];
    if (outputs[1]?.results?.message?.text) {
      const questionsText = outputs[1].results.message.text;
      // Parse questions - assuming they are separated by newlines or numbered
      followUpQuestions = questionsText
        .split('\n')
        .filter(line => line.trim() && !line.trim().match(/^\\d+\.\s*$/) && line.includes('?'))
        .map(q => q.replace(/^\\d+\.\s*/, '').trim());
    }
    
    console.log('Found follow-up questions:', followUpQuestions);
    
    const latency = Date.now() - startTime;

    // Create or get QA session with proper security checks
    let qaSession;
    if (sessionId) {
      // Get existing session with security validation
      const { data: existingSession, error: sessionError } = await supabase
        .from('qa_sessions')
        .select('*')
        .eq('id', sessionId)
        .eq('agent_id', agent.id)
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
          agent_id: agent.id,
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
          agent_id: agent.id
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
      
      // Get current conversation history and append new entry
      const currentHistory = qaSession.conversation_history || [];
      const updatedHistory = [...currentHistory, conversationEntry];
      
      const { error: updateError } = await supabase
        .from('qa_sessions')
        .update({
          conversation_history: updatedHistory,
          latency,
          // Don't update main answer for follow-up questions, keep original
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
    console.error('Error in ask-question-csv function:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Erro interno do servidor' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
