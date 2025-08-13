-- Fix security issue with shared agent tokens
-- Drop the existing problematic policy
DROP POLICY IF EXISTS "Users can view shared agents" ON public.agents;

-- Create a security definer function to safely check shared agents
CREATE OR REPLACE FUNCTION public.get_shared_agent_safe_fields(token_value text)
RETURNS TABLE(
  id uuid,
  name text,
  description text,
  created_at timestamptz,
  has_password boolean
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT 
    a.id,
    a.name,
    a.description,
    a.created_at,
    (a.share_password IS NOT NULL) as has_password
  FROM public.agents a
  WHERE a.share_token = token_value;
$$;

-- Create a new secure policy for shared agents that only exposes safe fields
CREATE POLICY "Users can view their own agents" 
ON public.agents 
FOR SELECT 
USING (auth.uid() = user_id);

-- Grant execute permission on the function to authenticated and anonymous users
GRANT EXECUTE ON FUNCTION public.get_shared_agent_safe_fields(text) TO authenticated, anon;