-- Update the function to include suggested_questions field
CREATE OR REPLACE FUNCTION public.get_shared_agent_safe_fields(token_value text)
 RETURNS TABLE(id uuid, name text, description text, created_at timestamp with time zone, has_password boolean, suggested_questions text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT 
    a.id,
    a.name,
    a.description,
    a.created_at,
    (a.share_password IS NOT NULL) as has_password,
    a.suggested_questions
  FROM public.agents a
  WHERE a.share_token = token_value;
$function$