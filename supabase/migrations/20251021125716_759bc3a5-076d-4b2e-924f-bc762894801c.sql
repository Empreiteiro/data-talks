-- Drop the restrictive INSERT policy
DROP POLICY IF EXISTS "Authenticated users can create agents" ON public.agents;

-- Create fully permissive INSERT policy
CREATE POLICY "Authenticated users can create agents"
ON public.agents
FOR INSERT
TO authenticated
WITH CHECK (true);