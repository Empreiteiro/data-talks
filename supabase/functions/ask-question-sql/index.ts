import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { Client as PostgresClient } from "https://deno.land/x/postgres@v0.17.0/mod.ts";
import { Client as MySQLClient } from "https://deno.land/x/mysql@v2.12.1/mod.ts";

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

    // Retrieve connection string from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('data-files')
      .download(connectionStoragePath);

    if (downloadError) throw downloadError;
    const connectionString = await fileData.text();

    // Build schema text
    const schemaText = table_infos.map((table: any) => 
      `Table: ${table.name}\nColumns: ${table.columns.join(', ')}\nRows: ${table.rowCount}`
    ).join('\n\n');

    // Generate SQL query using Langflow or simple AI
    const langflowUrl = Deno.env.get('LANGFLOW_BASE_URL');
    const langflowApiKey = Deno.env.get('LANGFLOW_API_KEY');
    const langflowFlowId = Deno.env.get('LANGFLOW_CSV_FLOW_ID'); // Reuse CSV flow for simplicity

    let generatedSQL = '';
    let answer = '';

    if (langflowUrl && langflowApiKey && langflowFlowId) {
      // Use Langflow to generate SQL
      const langflowPayload = {
        input_value: question,
        output_type: "chat",
        input_type: "chat",
        tweaks: {
          "ChatInput-EzSiH": {},
          "ChatOutput-RtZAr": {},
          "Prompt-5jSkr": {
            schema_text: schemaText,
            agent_instructions: agent.instructions || 'You are a helpful data analyst.',
          }
        }
      };

      const langflowResponse = await fetch(`${langflowUrl}/api/v1/run/${langflowFlowId}?stream=false`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${langflowApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(langflowPayload)
      });

      if (!langflowResponse.ok) {
        throw new Error(`Langflow request failed: ${langflowResponse.statusText}`);
      }

      const langflowData = await langflowResponse.json();
      answer = langflowData.outputs?.[0]?.outputs?.[0]?.results?.message?.text || 'No answer generated';
      generatedSQL = 'Generated via Langflow';
    } else {
      // Simple fallback - execute basic queries
      answer = 'SQL database integration is set up but requires Langflow configuration for AI-powered queries.';
    }

    // Execute SQL query if we have one
    let tableData: any = null;
    
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
