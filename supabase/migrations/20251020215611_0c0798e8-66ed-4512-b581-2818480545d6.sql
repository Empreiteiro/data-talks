-- Drop existing policy
DROP POLICY IF EXISTS "Users can create agents in their organization" ON public.agents;

-- Create a security definer function to check if user belongs to an organization
CREATE OR REPLACE FUNCTION public.user_belongs_to_organization(_user_id uuid, _organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND organization_id = _organization_id
  )
$$;

-- Create INSERT policy using the security definer function
CREATE POLICY "Users can create agents in their organization" 
ON public.agents 
FOR INSERT 
TO authenticated
WITH CHECK (
  auth.uid() = user_id 
  AND user_belongs_to_organization(auth.uid(), organization_id)
);