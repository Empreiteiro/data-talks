import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const langflowApiKey = Deno.env.get('LANGFLOW_API_KEY');
const langflowBaseUrl = Deno.env.get('LANGFLOW_BASE_URL');
const langflowCsvFlowId = Deno.env.get('LANGFLOW_CSV_FLOW_ID');
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
    const { question, agent, sources, sessionId, isShared, shareToken, userId } = await req.json();

    if (!question || !agent || !sources) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate userId for non-shared requests
    if (!isShared && !userId) {
      return new Response(
        JSON.stringify({ error: 'User ID is required for authenticated requests' }),
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

    const startTime = Date.now();
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
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
    
    // Generate session ID with agent prefix to avoid cross-contamination
    const langflowSessionId = `csv-${agent.id}-${crypto.randomUUID()}`;
    
    // Execute CSV flow
    const payload = {
      output_type: 'chat',
      input_type: 'chat',
      input_value: question,
      session_id: langflowSessionId,
      tweaks: {
        'File Path-LlOhc': {
          path: langflowPaths[0]
        },
        'File-7zqqu': {
          path: [langflowPaths[0]]
        },
        'Prompt Template-b14Tn': {
          description: agent.description || '',
          question: question,
          file_path: langflowPaths[0] || '',
        },
        'Memory-dPQjb': {
          session_id: langflowSessionId
        },
        'TextInput-nGp6X': {
          input_value: csvSchema
        }
      }
    };
    
    console.log('CSV Payload:', JSON.stringify(payload, null, 2));
    
    const langflowUrl = `${langflowBaseUrl}/api/v1/run/${langflowCsvFlowId}`;
    console.log('Calling Langflow URL:', langflowUrl);
    console.log('Langflow API Key present:', !!langflowApiKey);
    console.log('Langflow Base URL:', langflowBaseUrl);
    console.log('Langflow CSV Flow ID:', langflowCsvFlowId);
    
    const langflowResponse = await fetch(langflowUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify(payload),
    });
    
    console.log('Langflow response status:', langflowResponse.status);
    console.log('Langflow response headers:', Object.fromEntries(langflowResponse.headers.entries()));
    
    if (!langflowResponse.ok) {
      const errorText = await langflowResponse.text();
      console.error('Langflow error response:', errorText.substring(0, 1000));
      throw new Error(`Langflow API returned ${langflowResponse.status}: ${errorText.substring(0, 200)}`);
    }
    
    // Check content-type to ensure it's JSON
    const contentType = langflowResponse.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const responseText = await langflowResponse.text();
      console.error('Non-JSON response from Langflow:', responseText.substring(0, 500));
      throw new Error(`Langflow returned non-JSON response. Content-Type: ${contentType}. Response: ${responseText.substring(0, 200)}`);
    }
    
    const langflowData = await langflowResponse.json();
    console.log('Langflow CSV Response:', JSON.stringify(langflowData, null, 2));

    // For CSV responses, extract main answer and follow-up questions
    const outputs = langflowData.outputs?.[0]?.outputs || [];
    
    // First output contains the main answer
    const answer = outputs[0]?.results?.message?.text || 'Resposta não disponível';
    const imageUrl = outputs[0]?.results?.image_url || null;
    
    // Extract follow-up questions from multiple possible locations
    let followUpQuestions = [];
    
    // Try to get from second output first
    if (outputs[1]?.results?.message?.text) {
      const questionsText = outputs[1].results.message.text;
      console.log('Second output text:', questionsText);
      
      // Parse questions - look for lines with question marks
      const extractedQuestions = questionsText
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && line.includes('?'))
        .map(q => q.replace(/^\d+\.\s*/, '').replace(/^-\s*/, '').trim())
        .filter(q => q.length > 15); // Filter out very short questions
      
      followUpQuestions.push(...extractedQuestions);
    }
    
    // If no questions found in second output, try first output content blocks
    if (followUpQuestions.length === 0) {
      console.log('No questions in second output, trying content blocks');
      const contentBlocks = outputs[0]?.results?.message?.data?.content_blocks || [];
      
      for (const block of contentBlocks) {
        if (block.contents) {
          for (const content of block.contents) {
            if (content.type === 'text' && content.text && content.text.includes('?')) {
              const lines = content.text.split('\n');
              const questions = lines
                .map(line => line.trim())
                .filter(line => line && line.includes('?'))
                .map(q => q.replace(/^\d+\.\s*/, '').replace(/^-\s*/, '').trim())
                .filter(q => q.length > 15 && !q.toLowerCase().includes('pergunta'))
                .filter(q => !q.toLowerCase().includes('análise'))
                .filter(q => !q.toLowerCase().includes('arquivo'));
              
              followUpQuestions.push(...questions);
            }
          }
        }
      }
    }
    
    // Remove duplicates and limit to 3 questions
    followUpQuestions = [...new Set(followUpQuestions)].slice(0, 3);
    
    console.log('Final follow-up questions:', followUpQuestions);
    
    const latency = Date.now() - startTime;

    // Create or get QA session
    let qaSession;
    if (sessionId) {
      // Use existing session for follow-up questions
      const { data: existingSession, error: sessionError } = await supabase
        .from('qa_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

      if (sessionError || !existingSession) {
        console.error('Error finding existing session:', sessionError);
        throw new Error('Failed to find existing session');
      }
      
      qaSession = existingSession;
    } else {
      // For regular questions, create session with user_id
      const { data: sessionData, error: sessionError } = await supabase
        .from('qa_sessions')
        .insert({
          question,
          user_id: userId,
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
          conversation_history: [initialEntry],
          source_id: csvSources[0]?.id // Salvar qual fonte foi usada
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
