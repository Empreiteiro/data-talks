-- Drop the current policy
DROP POLICY IF EXISTS "Users can create agents" ON public.agents;

-- Create a corrected policy that properly validates organization_id during INSERT
-- The key is to reference the values being inserted, not the table itself
CREATE POLICY "Users can create agents" 
ON public.agents 
FOR INSERT 
WITH CHECK (
  auth.uid() = user_id 
  AND organization_id IN (
    SELECT organization_id FROM public.user_roles 
    WHERE user_id = auth.uid()
  )
);