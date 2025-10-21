-- Remove existing INSERT and UPDATE policies for agents table
DROP POLICY IF EXISTS "Users can create agents in their organization" ON public.agents;
DROP POLICY IF EXISTS "Organization admins can update agents" ON public.agents;
DROP POLICY IF EXISTS "Owners can update their own agents" ON public.agents;

-- Create permissive INSERT policy
CREATE POLICY "Authenticated users can create agents"
ON public.agents
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Create permissive UPDATE policy
CREATE POLICY "Authenticated users can update agents"
ON public.agents
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);