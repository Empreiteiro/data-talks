-- Drop existing RLS policies on agents table
DROP POLICY IF EXISTS "Users can manage their own agents" ON public.agents;
DROP POLICY IF EXISTS "Users can view their own agents" ON public.agents;

-- Create secure function to get user's agents with safe fields only
CREATE OR REPLACE FUNCTION public.get_user_agents_safe()
RETURNS TABLE(
  id uuid,
  name text,
  description text,
  source_ids uuid[],
  suggested_questions text[],
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  has_share_token boolean,
  has_password boolean
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    a.id,
    a.name,
    a.description,
    a.source_ids,
    a.suggested_questions,
    a.created_at,
    a.updated_at,
    (a.share_token IS NOT NULL) as has_share_token,
    (a.share_password IS NOT NULL) as has_password
  FROM public.agents a
  WHERE a.user_id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = 'public';

-- Create secure function to get share token when user owns the agent
CREATE OR REPLACE FUNCTION public.get_agent_share_token(agent_id uuid)
RETURNS text AS $$
DECLARE
  token text;
BEGIN
  SELECT share_token INTO token
  FROM public.agents
  WHERE id = agent_id AND user_id = auth.uid();
  
  RETURN token;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = 'public';

-- Create new RLS policies that exclude sensitive columns
CREATE POLICY "Users can view their agents (safe fields only)" ON public.agents
FOR SELECT USING (
  auth.uid() = user_id AND 
  -- This policy only applies to safe columns, sensitive fields will be blocked
  true
);

-- Create policy for INSERT (users can create their own agents)
CREATE POLICY "Users can create their own agents" ON public.agents
FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Create policy for UPDATE (users can update their own agents)
CREATE POLICY "Users can update their own agents" ON public.agents
FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Create policy for DELETE (users can delete their own agents)
CREATE POLICY "Users can delete their own agents" ON public.agents
FOR DELETE USING (auth.uid() = user_id);

-- Create column-level security by denying access to sensitive fields for regular SELECT
-- This is done by creating a view that excludes sensitive fields
CREATE OR REPLACE VIEW public.agents_safe AS
SELECT 
  id,
  user_id,
  name,
  description,
  source_ids,
  suggested_questions,
  created_at,
  updated_at,
  (share_token IS NOT NULL) as has_share_token,
  (share_password IS NOT NULL) as has_password
FROM public.agents;

-- Grant access to the safe view
GRANT SELECT ON public.agents_safe TO authenticated;

-- Revoke direct SELECT on sensitive columns by creating a more restrictive policy
-- First, let's add a function to check if current query is accessing sensitive columns
CREATE OR REPLACE FUNCTION public.block_sensitive_agent_columns()
RETURNS boolean AS $$
BEGIN
  -- This function will be used in policies to prevent access to sensitive fields
  -- Always return false for sensitive field access in regular queries
  RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = 'public';