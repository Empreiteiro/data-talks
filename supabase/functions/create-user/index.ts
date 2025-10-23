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
    
    console.log('Starting user invite process...');
    
    // Verify admin user
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !user) {
      console.error('Auth error:', userError);
      throw new Error('Unauthorized');
    }

    console.log('Admin user verified:', user.id);

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    
    // Get admin's organization
    const { data: adminRole, error: roleCheckError } = await supabaseAdmin
      .from('user_roles')
      .select('organization_id')
      .eq('user_id', user.id)
      .single();
    
    if (roleCheckError) {
      console.error('Role check error:', roleCheckError);
      throw new Error('Admin organization not found');
    }
    
    if (!adminRole?.organization_id) {
      console.error('No organization found for admin');
      throw new Error('Admin organization not found');
    }

    console.log('Admin organization:', adminRole.organization_id);

    const { email, role } = await req.json();
    console.log('Inviting user:', email, 'with role:', role);

    // Create user with invite (user will receive email to set password)
    const origin = req.headers.get('origin') || 'https://2dd880c5-0c69-4f0d-9f15-e15fec7986a3.lovableproject.com';
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${origin}/reset-password`
    });

    if (authError) {
      console.error('Invite error:', authError);
      
      // Tratamento específico para email já existente
      if (authError.status === 422 || authError.message?.includes('already been registered')) {
        return new Response(JSON.stringify({ 
          error: 'Este email já está cadastrado no sistema.' 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 422,
        });
      }
      
      throw authError;
    }
    
    if (!authData.user) {
      console.error('No user returned from invite');
      throw new Error('Failed to invite user');
    }

    console.log('User invited:', authData.user.id);

    // Assign role in the same organization
    const { error: roleError } = await supabaseAdmin
      .from('user_roles')
      .insert({
        user_id: authData.user.id,
        role,
        organization_id: adminRole.organization_id,
        created_by: user.id
      });

    if (roleError) {
      console.error('Role assignment error:', roleError);
      throw roleError;
    }

    console.log('Role assigned successfully');

    return new Response(JSON.stringify({ 
      success: true, 
      userId: authData.user.id,
      message: 'User invited successfully. They will receive an email to set their password.' 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error('Error in create-user function:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
