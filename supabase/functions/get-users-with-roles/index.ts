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

    // Get user roles from the same organization
    const { data: rolesData, error: rolesError } = await supabaseAdmin
      .from('user_roles')
      .select('id, user_id, role, created_at')
      .eq('organization_id', currentUserRole.organization_id);
    
    if (rolesError) throw rolesError;

    // Get user emails from auth.users
    const users = [];
    for (const roleData of rolesData) {
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.getUserById(roleData.user_id);
      
      if (authData?.user) {
        users.push({
          id: roleData.user_id,
          email: authData.user.email || '',
          role: roleData.role,
          created_at: roleData.created_at
        });
      }
    }

    return new Response(JSON.stringify(users), {
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
