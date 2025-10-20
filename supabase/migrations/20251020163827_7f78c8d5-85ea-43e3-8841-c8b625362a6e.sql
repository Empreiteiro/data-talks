-- Recriar a função is_organization_admin com bypass explícito de RLS
CREATE OR REPLACE FUNCTION public.is_organization_admin(_user_id uuid, _organization_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND organization_id = _organization_id
      AND role = 'admin'
  );
END;
$$;

-- Garantir que a policy em agents está correta
DROP POLICY IF EXISTS "Organization admins can create agents" ON public.agents;

CREATE POLICY "Organization admins can create agents" 
ON public.agents 
FOR INSERT 
WITH CHECK (
  is_organization_admin(auth.uid(), organization_id)
);