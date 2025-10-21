-- Drop the overly permissive INSERT policy
DROP POLICY IF EXISTS "Authenticated users can create agents" ON public.agents;

-- Create new specific INSERT policy that aligns with SELECT policies
CREATE POLICY "Users can create agents in their organization"
ON public.agents
FOR INSERT
TO authenticated
WITH CHECK (
  -- User must be the owner
  auth.uid() = user_id
  -- User must belong to the organization they're assigning
  AND user_belongs_to_organization(auth.uid(), organization_id)
);