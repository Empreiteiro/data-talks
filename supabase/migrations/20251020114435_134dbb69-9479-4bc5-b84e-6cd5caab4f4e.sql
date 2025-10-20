-- Fix can_access_workspace to filter by organization for admins
-- Admins should only see workspaces from their own organization

CREATE OR REPLACE FUNCTION public.can_access_workspace(_user_id uuid, _workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    -- User is owner
    SELECT 1 FROM public.agents WHERE id = _workspace_id AND user_id = _user_id
    UNION
    -- User has been granted access
    SELECT 1 FROM public.workspace_users WHERE workspace_id = _workspace_id AND user_id = _user_id
    UNION
    -- User is admin of the same organization as the workspace
    SELECT 1 
    FROM public.user_roles ur
    INNER JOIN public.agents a ON a.organization_id = ur.organization_id
    WHERE ur.user_id = _user_id 
      AND ur.role = 'admin' 
      AND a.id = _workspace_id
  )
$function$;