-- Fix function search path security issues
-- Update existing functions to have proper search_path set to 'public'

-- Fix get_shared_agent_qa_sessions function
CREATE OR REPLACE FUNCTION public.get_shared_agent_qa_sessions(token_value text)
 RETURNS TABLE(id uuid, question text, answer text, sql_query text, table_data jsonb, created_at timestamp with time zone, status text, latency integer, feedback text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT 
    qs.id,
    qs.question,
    qs.answer,
    qs.sql_query,
    qs.table_data,
    qs.created_at,
    qs.status,
    qs.latency,
    qs.feedback
  FROM public.qa_sessions qs
  JOIN public.agents a ON a.id = qs.agent_id
  WHERE a.share_token = token_value
  AND qs.is_shared = true
  ORDER BY qs.created_at DESC;
$function$;

-- Fix get_shared_agent_safe_fields function
CREATE OR REPLACE FUNCTION public.get_shared_agent_safe_fields(token_value text)
 RETURNS TABLE(id uuid, name text, description text, created_at timestamp with time zone, has_password boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT 
    a.id,
    a.name,
    a.description,
    a.created_at,
    (a.share_password IS NOT NULL) as has_password
  FROM public.agents a
  WHERE a.share_token = token_value;
$function$;

-- Add password hashing and verification functions for secure password handling
CREATE OR REPLACE FUNCTION public.hash_password(password_text text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Use crypt function with a salt to hash passwords
  RETURN crypt(password_text, gen_salt('bf', 8));
END;
$function$;

CREATE OR REPLACE FUNCTION public.verify_password(password_text text, password_hash text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Compare hashed password
  RETURN password_hash = crypt(password_text, password_hash);
END;
$function$;

-- Update verify_agent_share_password function to use proper search path and hashed passwords
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
  
  -- Check if the password matches using secure comparison
  RETURN verify_password(password_attempt, stored_password);
END;
$function$;

-- Update agent sharing function to hash passwords
CREATE OR REPLACE FUNCTION public.update_agent_sharing(agent_id uuid, enabled boolean, password text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, name text, description text, source_ids uuid[], suggested_questions text[], created_at timestamp with time zone, updated_at timestamp with time zone, has_share_token boolean, share_token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  new_token text;
  hashed_password text;
BEGIN
  -- Verify the user owns this agent
  IF NOT EXISTS (SELECT 1 FROM public.agents WHERE agents.id = agent_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Agent not found or access denied';
  END IF;
  
  -- Prepare update data
  IF enabled THEN
    new_token := gen_random_uuid()::text;
    
    -- Hash password if provided
    IF password IS NOT NULL AND password != '' THEN
      hashed_password := hash_password(password);
    ELSE
      hashed_password := NULL;
    END IF;
    
    UPDATE public.agents 
    SET 
      share_token = new_token,
      share_password = hashed_password,
      updated_at = now()
    WHERE agents.id = agent_id;
  ELSE
    UPDATE public.agents 
    SET 
      share_token = NULL,
      share_password = NULL,
      updated_at = now()
    WHERE agents.id = agent_id;
    new_token := NULL;
  END IF;
  
  -- Return safe data
  RETURN QUERY
  SELECT 
    a.id,
    a.name,
    a.description,
    a.source_ids,
    a.suggested_questions,
    a.created_at,
    a.updated_at,
    (a.share_token IS NOT NULL) as has_share_token,
    CASE WHEN enabled THEN new_token ELSE NULL END as share_token
  FROM public.agents a
  WHERE a.id = agent_id AND a.user_id = auth.uid();
END;
$function$;

-- Update password-only update function to use hashing
CREATE OR REPLACE FUNCTION public.update_agent_share_password_only(agent_id uuid, password text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  hashed_password text;
BEGIN
  -- Verify the user owns this agent and it has sharing enabled
  IF NOT EXISTS (
    SELECT 1 FROM public.agents 
    WHERE id = agent_id 
    AND user_id = auth.uid() 
    AND share_token IS NOT NULL
  ) THEN
    RETURN false;
  END IF;
  
  -- Hash password if provided
  IF password IS NOT NULL AND password != '' THEN
    hashed_password := hash_password(password);
  ELSE
    hashed_password := NULL;
  END IF;
  
  UPDATE public.agents 
  SET 
    share_password = hashed_password,
    updated_at = now()
  WHERE id = agent_id AND user_id = auth.uid();
  
  RETURN true;
END;
$function$;