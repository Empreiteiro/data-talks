-- Update RLS policy for agents table to use can_access_workspace function
-- This ensures users can only see workspaces they own, have explicit access to, or are admins

DROP POLICY IF EXISTS "Users can view agents from their organization" ON public.agents;

CREATE POLICY "Users can view accessible agents"
ON public.agents
FOR SELECT
TO authenticated
USING (can_access_workspace(auth.uid(), id));