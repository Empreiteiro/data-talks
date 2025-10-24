import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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
    const { connectionString, databaseType } = await req.json();

    console.log(`[list-sql-tables] Listing tables for ${databaseType}`);

    if (!connectionString || !databaseType) {
      throw new Error('connectionString and databaseType are required');
    }

    let tables: Array<{ name: string; type: string; rowCount?: number }> = [];

    if (databaseType === 'postgresql') {
      const client = new PostgresClient(connectionString);
      await client.connect();

      try {
        const result = await client.queryObject<{ tablename: string }>`
          SELECT tablename 
          FROM pg_catalog.pg_tables 
          WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
          ORDER BY tablename
        `;
        
        tables = result.rows.map(row => ({
          name: row.tablename,
          type: 'table'
        }));
      } finally {
        await client.end();
      }
    } else if (databaseType === 'mysql') {
      const client = await new MySQLClient().connect(connectionString);

      try {
        const result = await client.query('SHOW TABLES');
        
        tables = result.map((row: any) => ({
          name: Object.values(row)[0] as string,
          type: 'table'
        }));
      } finally {
        await client.close();
      }
    } else {
      throw new Error(`Unsupported database type: ${databaseType}`);
    }

    console.log(`[list-sql-tables] Found ${tables.length} tables`);

    return new Response(
      JSON.stringify({ tables }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[list-sql-tables] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
