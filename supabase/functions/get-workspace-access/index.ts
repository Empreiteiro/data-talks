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
    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    
    // Verify user is authenticated
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !user) throw new Error('Unauthorized');
    
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // Get current user's organization
    const { data: currentUserRole, error: currentRoleError } = await supabaseAdmin
      .from('user_roles')
      .select('organization_id')
      .eq('user_id', user.id)
      .single();
    
    if (currentRoleError || !currentUserRole?.organization_id) {
      throw new Error('Organization not found');
    }

    // Get workspace access records for workspaces in the user's organization
    const { data: accessData, error: accessError } = await supabaseAdmin
      .from('workspace_users')
      .select(`
        id, 
        workspace_id, 
        user_id, 
        created_at,
        agents!inner(organization_id)
      `)
      .eq('agents.organization_id', currentUserRole.organization_id);
    
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
