-- Drop existing INSERT policy
DROP POLICY IF EXISTS "Users can create agents in their organization" ON public.agents;

-- Create simplified INSERT policy - just check user ownership
-- Application code already handles organization_id assignment
CREATE POLICY "Users can create agents"
ON public.agents
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
);

-- Create comprehensive SELECT policy
-- Allows users to see: their own agents, shared agents, or all org agents if admin
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
  -- User is admin of the same organization
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role = 'admin'
      AND organization_id = agents.organization_id
  )
);