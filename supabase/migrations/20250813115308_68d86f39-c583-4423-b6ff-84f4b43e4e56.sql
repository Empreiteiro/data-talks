-- Create the verify_agent_share_password function
CREATE OR REPLACE FUNCTION public.verify_agent_share_password(token_value text, password_attempt text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  stored_password text;
BEGIN
  -- Get the password for the agent with the given token
  SELECT share_password INTO stored_password
  FROM public.agents
  WHERE share_token = token_value;
  
  -- If no agent found with this token, return false
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  
  -- If no password is set, allow access
  IF stored_password IS NULL THEN
    RETURN true;
  END IF;
  
  -- Check if the password matches
  RETURN stored_password = password_attempt;
END;
$function$;