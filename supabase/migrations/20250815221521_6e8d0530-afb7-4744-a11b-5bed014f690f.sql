-- First, check existing policies and drop them properly
DROP POLICY IF EXISTS "Users can view their agents (safe fields only)" ON public.agents;

-- Create a more restrictive approach using a different strategy
-- We'll update the client code to use secure functions instead of direct table access

-- Create secure function to update agent sharing settings
CREATE OR REPLACE FUNCTION public.update_agent_sharing(
  agent_id uuid,
  enabled boolean,
  password text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  name text,
  description text,
  source_ids uuid[],
  suggested_questions text[],
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  has_share_token boolean,
  share_token text
) AS $$
DECLARE
  new_token text;
  update_data jsonb;
BEGIN
  -- Verify the user owns this agent
  IF NOT EXISTS (SELECT 1 FROM public.agents WHERE agents.id = agent_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Agent not found or access denied';
  END IF;
  
  -- Prepare update data
  IF enabled THEN
    new_token := gen_random_uuid()::text;
    UPDATE public.agents 
    SET 
      share_token = new_token,
      share_password = password,
      updated_at = now()
    WHERE agents.id = agent_id;
  ELSE
    UPDATE public.agents 
    SET 
      share_token = NULL,
      share_password = NULL,
      updated_at = now()
    WHERE agents.id = agent_id;
    new_token := NULL;
  END IF;
  
  -- Return safe data
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
    CASE WHEN enabled THEN new_token ELSE NULL END as share_token
  FROM public.agents a
  WHERE a.id = agent_id AND a.user_id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public';

-- Create secure function to update agent share password only
CREATE OR REPLACE FUNCTION public.update_agent_share_password_only(
  agent_id uuid,
  password text
)
RETURNS boolean AS $$
BEGIN
  -- Verify the user owns this agent and it has sharing enabled
  IF NOT EXISTS (
    SELECT 1 FROM public.agents 
    WHERE id = agent_id 
    AND user_id = auth.uid() 
    AND share_token IS NOT NULL
  ) THEN
    RETURN false;
  END IF;
  
  UPDATE public.agents 
  SET 
    share_password = CASE WHEN password = '' THEN NULL ELSE password END,
    updated_at = now()
  WHERE id = agent_id AND user_id = auth.uid();
  
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public';

-- Recreate the safe SELECT policy
CREATE POLICY "Users can view their agents (safe fields only)" ON public.agents
FOR SELECT USING (
  auth.uid() = user_id
);