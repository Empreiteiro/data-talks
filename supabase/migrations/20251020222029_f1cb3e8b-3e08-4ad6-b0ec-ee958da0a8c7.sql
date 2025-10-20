-- Fix: Create security definer function to check agent access without recursion
CREATE OR REPLACE FUNCTION public.user_can_access_agent(_user_id uuid, _agent_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  agent_user_id uuid;
  agent_org_id uuid;
BEGIN
  -- Get agent owner and organization (bypasses RLS with SECURITY DEFINER)
  SELECT user_id, organization_id 
  INTO agent_user_id, agent_org_id
  FROM public.agents
  WHERE id = _agent_id;
  
  -- User is owner
  IF agent_user_id = _user_id THEN
    RETURN true;
  END IF;
  
  -- User has workspace access
  IF EXISTS (
    SELECT 1 FROM public.workspace_users
    WHERE workspace_id = _agent_id
      AND user_id = _user_id
  ) THEN
    RETURN true;
  END IF;
  
  -- User is admin of the same organization
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND organization_id = agent_org_id
      AND role = 'admin'
  ) THEN
    RETURN true;
  END IF;
  
  RETURN false;
END;
$$;

-- Drop the problematic policy
DROP POLICY IF EXISTS "Users can view accessible agents" ON public.agents;

-- Create new SELECT policy using the security definer function
CREATE POLICY "Users can view accessible agents"
ON public.agents
FOR SELECT
TO authenticated
USING (
  user_can_access_agent(auth.uid(), id)
);