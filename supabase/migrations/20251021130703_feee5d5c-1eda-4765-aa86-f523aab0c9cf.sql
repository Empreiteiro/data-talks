-- Drop existing SELECT policies that may be causing issues
DROP POLICY IF EXISTS "Users can view their own role" ON public.user_roles;
DROP POLICY IF EXISTS "Organization admins can view roles from their org" ON public.user_roles;

-- Recreate SELECT policies with proper authentication checks
CREATE POLICY "Users can view their own role"
ON public.user_roles
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Admins can view organization roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (is_organization_admin(auth.uid(), organization_id));

-- Ensure RLS is enabled
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;