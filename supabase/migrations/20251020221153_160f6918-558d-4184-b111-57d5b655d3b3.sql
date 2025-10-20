-- Fix infinite recursion in agents SELECT policy
-- Drop the problematic policy
DROP POLICY IF EXISTS "Users can view accessible agents" ON public.agents;

-- Create corrected SELECT policy using security definer function
-- This avoids recursion by using the is_organization_admin function
CREATE POLICY "Users can view accessible agents"
ON public.agents
FOR SELECT
TO authenticated
USING (
  -- User is the owner
  auth.uid() = user_id
  OR
  -- User has been granted access via workspace_users
  EXISTS (
    SELECT 1 FROM public.workspace_users
    WHERE workspace_id = agents.id
      AND user_id = auth.uid()
  )
  OR
  -- User is admin of the same organization (using security definer function)
  is_organization_admin(auth.uid(), agents.organization_id)
);