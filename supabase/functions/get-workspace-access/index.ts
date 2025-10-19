import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // Get workspace access records
    const { data: accessData, error: accessError } = await supabaseAdmin
      .from('workspace_users')
      .select('id, workspace_id, user_id, created_at');
    
    if (accessError) throw accessError;

    // Enrich with workspace and user details
    const accessList = [];
    for (const access of accessData) {
      const { data: workspace } = await supabaseAdmin
        .from('agents')
        .select('name')
        .eq('id', access.workspace_id)
        .single();

      const { data: authData } = await supabaseAdmin.auth.admin.getUserById(access.user_id);

      if (workspace && authData?.user) {
        accessList.push({
          id: access.id,
          workspace_id: access.workspace_id,
          workspace_name: workspace.name,
          user_id: access.user_id,
          user_email: authData.user.email || '',
          granted_at: access.created_at
        });
      }
    }

    return new Response(JSON.stringify(accessList), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
