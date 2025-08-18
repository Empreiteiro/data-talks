import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const langflowBigqueryApiKey = Deno.env.get('LANGFLOW_BIGQUERY_API_KEY');
const langflowBigqueryUrl = Deno.env.get('LANGFLOW_BIGQUERY_URL');
const langflowBigqueryFlowId = Deno.env.get('LANGFLOW_BIGQUERY_FLOW_ID');
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

    // Validate BigQuery configuration
    console.log('BigQuery API key present:', !!langflowBigqueryApiKey);
    console.log('BigQuery URL present:', !!langflowBigqueryUrl);
    console.log('BigQuery Flow ID present:', !!langflowBigqueryFlowId);
    
    if (!langflowBigqueryApiKey || !langflowBigqueryUrl || !langflowBigqueryFlowId) {
      console.error('Missing BigQuery configuration:', {
        hasApiKey: !!langflowBigqueryApiKey,
        hasUrl: !!langflowBigqueryUrl,
        hasFlowId: !!langflowBigqueryFlowId
      });
      return new Response(
        JSON.stringify({ error: 'Langflow BigQuery configuration not complete' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const startTime = Date.now();
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get BigQuery source metadata
    const bigquerySource = sources.find(s => s.type === 'bigquery');
    if (!bigquerySource) {
      return new Response(
        JSON.stringify({ error: 'BigQuery source not found' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const metadata = bigquerySource.metadata || {};
    console.log('BigQuery source metadata:', JSON.stringify(metadata, null, 2));
    console.log('BigQuery source langflow_path:', bigquerySource.langflow_path);
    
    // Check credentials path availability early
    const credentialsPath = bigquerySource.langflow_path ||
      metadata.service_account_json_file ||
      metadata.credentials_file ||
      metadata.service_account ||
      metadata.service_account_filename ||
      metadata.credentials_name;
      
    if (!credentialsPath) {
      console.error('No credentials file path found for BigQuery source:', bigquerySource.name);
      return new Response(
        JSON.stringify({ error: 'BigQuery credentials file not configured. Please upload a service account JSON file.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Build schema from table_infos
    let schemaText = "";
    if (metadata.table_infos && Array.isArray(metadata.table_infos)) {
      schemaText = metadata.table_infos.map(tableInfo => {
        const tableName = tableInfo.table_name || "";
        const columns = tableInfo.columns || [];
        return `Tabela: ${tableName}\nColunas: ${columns.join(', ')}`;
      }).join('\n\n');
    }
    
    console.log('Schema construído:', schemaText);
    
    // Generate session ID with agent prefix to avoid cross-contamination
    const langflowSessionId = `bigquery-${agent.id}-${crypto.randomUUID()}`;
    
    // Build payload using the same structure as CSV flow
    const payload = {
      output_type: "chat",
      input_type: "text",
      input_value: question,
      session_id: langflowSessionId,
      tweaks: {
        "Prompt-7HDgb": {
          Schema: schemaText,
          table: metadata.table || (Array.isArray(metadata.tables) && metadata.tables[0]) || (Array.isArray(metadata.table_infos) && metadata.table_infos[0]?.table_name) || "",
          project: metadata.project || metadata.project_id || "",
          dataset: metadata.dataset || metadata.dataset_id || ""
        },
        "File-lER3y": {
          path: [(() => {
            console.log('Looking for credentials file...');
            console.log('BigQuery source langflow_path:', bigquerySource.langflow_path);
            console.log('BigQuery source metadata fields:', Object.keys(metadata));
            
            // Primary: Use langflow_path like CSV agent does
            let credentialsPath = bigquerySource.langflow_path;
            
            // Fallback: Try metadata fields if langflow_path is empty
            if (!credentialsPath) {
              credentialsPath = metadata.service_account_json_file ||
                metadata.credentials_file ||
                metadata.service_account ||
                metadata.service_account_filename ||
                metadata.credentials_name ||
                "";
              console.log('Using fallback metadata path:', credentialsPath);
            } else {
              console.log('Using primary langflow_path:', credentialsPath);
            }
            
            if (!credentialsPath) {
              console.error('ERROR: No credentials file path found! Check BigQuery source configuration.');
              return "";
            }
            
            console.log('Final credentials path sent to Langflow:', credentialsPath);
            return credentialsPath;
          })()]
        },
        "Prompt Template-RF5j9": {
          question: question,
          schema: schemaText
        },
        "Python REPL Tool-eYPvH": {
          chart_without_border: "true"
        }
      }
    };

    console.log('=== PAYLOAD COMPLETO PARA BIGQUERY ===');
    console.log(JSON.stringify(payload, null, 2));
    console.log('=== FIM DO PAYLOAD ===');
    
    // Construct the complete Langflow API URL as specified
    const langflowApiUrl = `${langflowBigqueryUrl.replace(/\/$/, '')}/api/v1/run/${langflowBigqueryFlowId}`;
    
    console.log('BigQuery API URL:', langflowApiUrl);
    
    const headers = { 'x-api-key': langflowBigqueryApiKey };
    
    const langflowResponse = await fetch(langflowApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify(payload),
    });
    
    const langflowData = await langflowResponse.json();
    
    console.log('Langflow BigQuery Response status:', langflowResponse.status);
    console.log('Langflow BigQuery Response:', JSON.stringify(langflowData, null, 2));
    
    if (!langflowResponse.ok) {
      console.error('=== ERRO NA RESPOSTA DO LANGFLOW ===');
      console.error('Status:', langflowResponse.status);
      console.error('Status Text:', langflowResponse.statusText);
      console.error('Response data:', langflowData);
      console.error('Response headers:', Object.fromEntries(langflowResponse.headers.entries()));
      console.error('=== FIM DO ERRO ===');
      throw new Error(`Erro na API do Langflow BigQuery: ${langflowResponse.status} - ${JSON.stringify(langflowData)}`);
    }

    // For BigQuery responses, extract base64 image and text separately
    let answer = 'Resposta não disponível';
    let imageUrl = null;
    let followUpQuestions = [];
    
    if (langflowData.outputs?.[0]?.outputs) {
      console.log('Processing BigQuery outputs:', JSON.stringify(langflowData.outputs[0].outputs, null, 2));
      
      // Look for base64 and text outputs in BigQuery response
      const outputs = langflowData.outputs[0].outputs;
      
      for (const output of outputs) {
        if (output.results?.message?.data?.text) {
          let textResponse = output.results.message.data.text;
          console.log('Found text response:', textResponse);
          
          // Check if the text contains JSON that needs to be parsed
          if (textResponse.includes('```json') || textResponse.startsWith('{')) {
            try {
              // Try to extract JSON from the response
              let jsonString = textResponse;
              
              // Remove code blocks if present
              if (textResponse.includes('```json')) {
                const jsonMatch = textResponse.match(/```json\s*([\s\S]*?)\s*```/);
                if (jsonMatch) {
                  jsonString = jsonMatch[1];
                }
              }
              
              // Parse the JSON and extract text and image
              const parsedResponse = JSON.parse(jsonString);
              
              if (parsedResponse.text) {
                answer = parsedResponse.text;
                console.log('Extracted text from JSON:', answer);
              }
              
              if (parsedResponse.image) {
                let imageData = parsedResponse.image;
                
                // Clean up image data - remove ANSI codes and other artifacts
                imageData = imageData.replace(/\u001b\[[0-9;]*m/g, ''); // Remove ANSI codes
                imageData = imageData.replace(/^> Entering new.*?\r?\n/g, ''); // Remove chain logs
                imageData = imageData.trim();
                
                // If image doesn't start with data:image, add the prefix
                if (imageData && !imageData.startsWith('data:image/')) {
                  imageUrl = `data:image/png;base64,${imageData}`;
                } else {
                  imageUrl = imageData;
                }
                console.log('Extracted image from JSON');
              }
            } catch (parseError) {
              console.error('Failed to parse JSON response:', parseError);
              answer = textResponse; // Use original text as fallback
            }
          } else {
            answer = textResponse;
          }
        }
        // Legacy fallback for old format
        else if (output.results) {
          // Check for base64 image data
          if (output.results.base64 || (typeof output.results.message === 'string' && output.results.message.startsWith('data:image'))) {
            const base64Data = output.results.base64 || output.results.message;
            // Convert base64 to a proper data URL if it's not already
            if (base64Data && !base64Data.startsWith('data:')) {
              imageUrl = `data:image/png;base64,${base64Data}`;
            } else {
              imageUrl = base64Data;
            }
            console.log('Found base64 image data (legacy)');
          }
          
          // Check for text response
          if (output.results.message?.text) {
            answer = output.results.message.text;
            console.log('Found text response (legacy):', answer);
          } else if (typeof output.results.message === 'string' && !output.results.message.startsWith('data:image')) {
            answer = output.results.message;
            console.log('Found text response (legacy):', answer);
          }
        }
      }
    }
    
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
    console.error('Error in ask-question-bigquery function:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Erro interno do servidor' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
