import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { question, agent, sources, sessionId, userId } = await req.json();

    console.log(`[ask-question-sql] Question: "${question}" for agent: ${agent.id}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Find SQL database source
    const sqlSource = sources.find((s: any) => s.type === 'sql_database');
    if (!sqlSource) {
      throw new Error('No SQL database source found');
    }

    const { databaseType, table_infos, connectionStoragePath } = sqlSource.metadata;

    console.log('[ask-question-sql] Connection storage path:', connectionStoragePath);

    // Retrieve connection string from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('data-files')
      .download(connectionStoragePath);

    if (downloadError) {
      console.error('[ask-question-sql] Error downloading connection string:', downloadError);
      throw downloadError;
    }
    
    const connectionString = await fileData.text();
    console.log('[ask-question-sql] Connection string retrieved, length:', connectionString.length);

    // Build schema text
    const schemaText = table_infos.map((table: any) => 
      `Table: ${table.name}\nColumns: ${table.columns.join(', ')}\nRows: ${table.rowCount}`
    ).join('\n\n');

    // Generate SQL query using Langflow
    const langflowUrl = Deno.env.get('LANGFLOW_BASE_URL');
    const langflowApiKey = Deno.env.get('LANGFLOW_API_KEY');
    const langflowFlowId = '9cd26f45-dc9a-4f27-a023-e223acd53b3b';

    let generatedSQL = '';
    let answer = '';
    let tableData: any = null;

    if (langflowUrl && langflowApiKey) {
      // Use Langflow to generate and execute SQL
      const langflowPayload = {
        input_value: question,
        output_type: "chat",
        input_type: "chat",
        tweaks: {
          "Prompt Template-05Bvn": {
            schema: schemaText
          },
          "CustomComponent-LYPAw": {
            database_url: connectionString
          },
          "Prompt Template-PPAl6": {
            Table: table_infos.map((t: any) => t.name).join(', ')
          }
        }
      };

      console.log('[ask-question-sql] Calling Langflow with Flow ID:', langflowFlowId);
      console.log('[ask-question-sql] Database URL in tweak:', connectionString ? 'SET (masked)' : 'EMPTY');
      console.log('[ask-question-sql] Tables:', table_infos.map((t: any) => t.name).join(', '));
      
      const langflowResponse = await fetch(`${langflowUrl}/api/v1/run/${langflowFlowId}?stream=false&x-api-key=${langflowApiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(langflowPayload)
      });

      console.log('[ask-question-sql] Langflow response status:', langflowResponse.status);

      if (!langflowResponse.ok) {
        const errorText = await langflowResponse.text();
        console.error('[ask-question-sql] Langflow error:', errorText);
        throw new Error(`Langflow request failed: ${langflowResponse.statusText}`);
      }

      const langflowData = await langflowResponse.json();
      answer = langflowData.outputs?.[0]?.outputs?.[0]?.results?.message?.text || 'No answer generated';
      
      console.log('[ask-question-sql] Langflow response received');
    } else {
      throw new Error('Langflow configuration is missing');
    }

    // Save QA session
    const { data: qaSession, error: qaError } = await supabase
      .from('qa_sessions')
      .insert({
        user_id: userId,
        agent_id: agent.id,
        source_id: sqlSource.id,
        question,
        answer,
        sql_query: generatedSQL,
        table_data: tableData,
        status: 'completed',
        conversation_history: []
      })
      .select()
      .single();

    if (qaError) throw qaError;

    console.log(`[ask-question-sql] QA session created: ${qaSession.id}`);

    return new Response(
      JSON.stringify({ 
        answer,
        sql_query: generatedSQL,
        table_data: tableData,
        session_id: qaSession.id
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[ask-question-sql] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
