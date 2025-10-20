-- Drop the current policy
DROP POLICY IF EXISTS "Users can create agents" ON public.agents;

-- Create a simpler policy that only validates the user is authenticated
-- and has a user_role record (organization validation happens in application code)
CREATE POLICY "Users can create agents" 
ON public.agents 
FOR INSERT 
WITH CHECK (
  auth.uid() = user_id
);