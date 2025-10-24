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
    const { connectionString, databaseType, tableName, agentId } = await req.json();

    console.log(`[sql-database-connect] Connecting to ${databaseType}, table: ${tableName || 'all'}`);

    if (!connectionString || !databaseType) {
      throw new Error('connectionString and databaseType are required');
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

    let tableInfos: any[] = [];
    let availableColumns: string[] = [];
    let previewData: any[] = [];

    if (databaseType === 'postgresql') {
      const client = new PostgresClient(connectionString);
      await client.connect();

      try {
        if (tableName) {
          // Get columns info
          const columnsResult = await client.queryObject<{ column_name: string; data_type: string }>`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = ${tableName}
            ORDER BY ordinal_position
          `;
          
          availableColumns = columnsResult.rows.map(row => row.column_name);

          // Get preview data
          const previewResult = await client.queryObject(`SELECT * FROM ${tableName} LIMIT 5`);
          previewData = previewResult.rows;

          // Get row count
          const countResult = await client.queryObject<{ count: number }>`SELECT COUNT(*) as count FROM ${tableName}`;
          const rowCount = countResult.rows[0]?.count || 0;

          tableInfos = [{
            name: tableName,
            columns: columnsResult.rows.map(row => `${row.column_name} (${row.data_type})`),
            rowCount
          }];
        }
      } finally {
        await client.end();
      }
    } else if (databaseType === 'mysql') {
      const client = await new MySQLClient().connect(connectionString);

      try {
        if (tableName) {
          // Get columns info
          const columnsResult = await client.query(`DESCRIBE ${tableName}`);
          
          availableColumns = columnsResult.map((row: any) => row.Field);

          // Get preview data
          previewData = await client.query(`SELECT * FROM ${tableName} LIMIT 5`);

          // Get row count
          const countResult = await client.query(`SELECT COUNT(*) as count FROM ${tableName}`);
          const rowCount = countResult[0]?.count || 0;

          tableInfos = [{
            name: tableName,
            columns: columnsResult.map((row: any) => `${row.Field} (${row.Type})`),
            rowCount
          }];
        }
      } finally {
        await client.close();
      }
    }

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
