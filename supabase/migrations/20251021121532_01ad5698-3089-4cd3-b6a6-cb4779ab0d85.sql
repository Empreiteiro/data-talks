-- Add UPDATE policies for agents table
CREATE POLICY "Organization admins can update agents"
ON public.agents
FOR UPDATE
TO authenticated
USING (
  is_organization_admin(auth.uid(), organization_id)
)
WITH CHECK (
  is_organization_admin(auth.uid(), organization_id)
);

CREATE POLICY "Owners can update their own agents"
ON public.agents
FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid()
)
WITH CHECK (
  user_id = auth.uid() AND
  organization_id = user_organization_id(auth.uid())
);

-- Add DELETE policies for agents table
CREATE POLICY "Organization admins can delete agents"
ON public.agents
FOR DELETE
TO authenticated
USING (
  is_organization_admin(auth.uid(), organization_id)
);

CREATE POLICY "Owners can delete their own agents"
ON public.agents
FOR DELETE
TO authenticated
USING (
  user_id = auth.uid()
);

-- Add INSERT policy to ensure proper validation
CREATE POLICY "Users can create agents in their organization"
ON public.agents
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id AND
  organization_id = user_organization_id(auth.uid())
);

-- Add SELECT policy using the security definer function
CREATE POLICY "Users can view accessible agents"
ON public.agents
FOR SELECT
TO authenticated
USING (
  user_can_access_agent(auth.uid(), id)
);