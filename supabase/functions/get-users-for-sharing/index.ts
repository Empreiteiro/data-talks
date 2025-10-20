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

    // Get all users from the same organization except current user
    const { data: rolesData, error: rolesError } = await supabaseAdmin
      .from('user_roles')
      .select('user_id')
      .eq('organization_id', currentUserRole.organization_id)
      .neq('user_id', user.id);
    
    if (rolesError) throw rolesError;

    const users = [];
    for (const roleData of rolesData) {
      const { data: authData } = await supabaseAdmin.auth.admin.getUserById(roleData.user_id);
      if (authData?.user) {
        users.push({
          id: authData.user.id,
          email: authData.user.email || ''
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
