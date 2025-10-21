-- Fix handle_new_user_role to work for ALL users, not just the first one
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  new_org_id UUID;
  user_has_role BOOLEAN;
BEGIN
  -- Check if user already has a role
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = NEW.id
  ) INTO user_has_role;
  
  -- If user already has a role, skip
  IF user_has_role THEN
    RETURN NEW;
  END IF;
  
  -- Check if this is the first user (first organization)
  IF NOT EXISTS (SELECT 1 FROM public.organizations LIMIT 1) THEN
    -- Create first organization
    INSERT INTO public.organizations (name)
    VALUES ('Minha Organização')
    RETURNING id INTO new_org_id;
    
    -- First user becomes admin of the first organization
    INSERT INTO public.user_roles (user_id, role, organization_id, created_by)
    VALUES (NEW.id, 'admin', new_org_id, NEW.id);
  ELSE
    -- For subsequent users, create their own organization
    INSERT INTO public.organizations (name)
    VALUES ('Organização de ' || COALESCE(NEW.email, 'Usuário'))
    RETURNING id INTO new_org_id;
    
    -- User becomes admin of their own organization
    INSERT INTO public.user_roles (user_id, role, organization_id, created_by)
    VALUES (NEW.id, 'admin', new_org_id, NEW.id);
  END IF;
  
  RETURN NEW;
END;
$function$;