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
    const { connectionString, databaseType, tableName, agentId } = await req.json();

    console.log(`[sql-database-connect] Connecting to ${databaseType}, table: ${tableName || 'all'}`);

    if (!connectionString || !databaseType || !tableName) {
      throw new Error('connectionString, databaseType and tableName are required');
    }

    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) throw new Error('Unauthorized');

    // Get Langflow configuration
    const langflowUrl = Deno.env.get('LANGFLOW_BASE_URL');
    const langflowApiKey = Deno.env.get('LANGFLOW_API_KEY');
    const langflowFlowId = Deno.env.get('LANGFLOW_SQL_FLOW_ID');

    if (!langflowUrl || !langflowApiKey || !langflowFlowId) {
      throw new Error('Langflow configuration is missing');
    }

    // Call Langflow to get table schema and preview
    const langflowPayload = {
      input_value: "Get table schema and preview",
      output_type: "chat",
      input_type: "chat",
      tweaks: {
        "SQLComponent-9tQSf": {
          database_url: connectionString
        },
        "Prompt Template-DWgjC": {
          table: tableName
        }
      }
    };

    console.log('[sql-database-connect] Calling Langflow with Flow ID:', langflowFlowId);
    console.log('[sql-database-connect] Langflow URL:', langflowUrl);
    
    const langflowResponse = await fetch(`${langflowUrl}/api/v1/run/${langflowFlowId}?stream=false`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${langflowApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(langflowPayload)
    });

    console.log('[sql-database-connect] Langflow response status:', langflowResponse.status);
    
    if (!langflowResponse.ok) {
      const errorText = await langflowResponse.text();
      console.error('[sql-database-connect] Langflow error response:', errorText);
      throw new Error(`Langflow request failed: ${langflowResponse.statusText}. Response: ${errorText}`);
    }

    const langflowData = await langflowResponse.json();
    const langflowResult = langflowData.outputs?.[0]?.outputs?.[0]?.results?.message?.text || '';

    console.log('[sql-database-connect] Langflow response:', langflowResult);

    // Parse Langflow response to extract columns and preview data
    let availableColumns: string[] = [];
    let previewData: any[] = [];
    let tableInfos: any[] = [];

    try {
      // Try to parse as JSON if Langflow returns structured data
      const parsedResult = JSON.parse(langflowResult);
      if (parsedResult.columns && Array.isArray(parsedResult.columns)) {
        availableColumns = parsedResult.columns;
      }
      if (parsedResult.preview && Array.isArray(parsedResult.preview)) {
        previewData = parsedResult.preview;
      }
    } catch (e) {
      // If not JSON, try to extract columns from text response
      console.log('[sql-database-connect] Could not parse as JSON, using text extraction');
      
      // Extract columns from response text (assuming format like "Column1, Column2, Column3")
      const columnMatch = langflowResult.match(/columns?:\s*\[?([^\]\n]+)\]?/i);
      if (columnMatch) {
        availableColumns = columnMatch[1].split(',').map((col: string) => col.trim().replace(/['"]/g, ''));
      }
    }

    tableInfos = [{
      name: tableName,
      columns: availableColumns,
      rowCount: previewData.length
    }];

    // Store connection string securely in Supabase Storage
    const storagePath = `sql-connections/${user.id}/${crypto.randomUUID()}.txt`;
    const { error: uploadError } = await supabase.storage
      .from('data-files')
      .upload(storagePath, connectionString, {
        contentType: 'text/plain',
        upsert: false
      });

    if (uploadError) throw uploadError;

    // Create source record
    const sourceName = tableName ? `${databaseType.toUpperCase()}: ${tableName}` : `${databaseType.toUpperCase()} Database`;
    
    const sourceData: any = {
      user_id: user.id,
      name: sourceName,
      type: 'sql_database',
      metadata: {
        databaseType,
        table_infos: tableInfos,
        availableColumns,
        previewData,
        connectionStoragePath: storagePath
      },
      is_active: !!agentId,
      agent_id: agentId || null
    };

    const { data: source, error: sourceError } = await supabase
      .from('sources')
      .insert(sourceData)
      .select()
      .single();

    if (sourceError) throw sourceError;

    // If agentId provided, deactivate other sources and update agent
    if (agentId) {
      await supabase
        .from('sources')
        .update({ is_active: false })
        .eq('agent_id', agentId)
        .neq('id', source.id);

      await supabase
        .from('agents')
        .update({ 
          source_ids: [source.id],
          updated_at: new Date().toISOString()
        })
        .eq('id', agentId);
    }

    console.log(`[sql-database-connect] Source created: ${source.id}`);

    return new Response(
      JSON.stringify({ 
        source,
        tableInfos,
        availableColumns,
        previewData
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[sql-database-connect] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
