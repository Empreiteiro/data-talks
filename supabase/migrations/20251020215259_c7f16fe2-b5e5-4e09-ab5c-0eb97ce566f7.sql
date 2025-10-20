-- Create INSERT policy for agents
-- Both admins and regular users can create agents in their organization
CREATE POLICY "Users can create agents in their organization" 
ON public.agents 
FOR INSERT 
TO authenticated
WITH CHECK (
  auth.uid() = user_id 
  AND EXISTS (
    SELECT 1 
    FROM public.user_roles 
    WHERE user_roles.user_id = auth.uid() 
    AND user_roles.organization_id = agents.organization_id
  )
);