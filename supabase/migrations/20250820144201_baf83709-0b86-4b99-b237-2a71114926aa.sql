-- CRITICAL SECURITY FIX 1: Add authorization validation functions
CREATE OR REPLACE FUNCTION public.validate_user_access(target_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only allow access if the requesting user matches the target user
  RETURN auth.uid() = target_user_id;
END;
$$;

-- CRITICAL SECURITY FIX 2: Add shared agent access validation
CREATE OR REPLACE FUNCTION public.validate_shared_agent_access(agent_id_param uuid, share_token_param text, user_password text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  agent_record RECORD;
BEGIN
  -- Get agent with share settings
  SELECT share_token, share_password 
  INTO agent_record
  FROM public.agents 
  WHERE id = agent_id_param;
  
  -- Check if agent exists and sharing is enabled
  IF NOT FOUND OR agent_record.share_token IS NULL THEN
    RETURN false;
  END IF;
  
  -- Validate share token
  IF agent_record.share_token != share_token_param THEN
    RETURN false;
  END IF;
  
  -- If agent has password protection, validate it
  IF agent_record.share_password IS NOT NULL THEN
    IF user_password IS NULL THEN
      RETURN false;
    END IF;
    
    -- Use existing password verification function
    RETURN verify_password(user_password, agent_record.share_password);
  END IF;
  
  -- No password required, allow access
  RETURN true;
END;
$$;

-- CRITICAL SECURITY FIX 3: Harden QA Sessions RLS policies
DROP POLICY IF EXISTS "Allow reading shared QA sessions" ON public.qa_sessions;
DROP POLICY IF EXISTS "Users can manage their own QA sessions" ON public.qa_sessions;

-- Replace with more restrictive policies
CREATE POLICY "Users can view their own QA sessions"
ON public.qa_sessions
FOR SELECT
USING (
  (auth.uid() = user_id) OR 
  (is_shared = true AND share_token IS NOT NULL)
);

CREATE POLICY "Users can create their own QA sessions"
ON public.qa_sessions
FOR INSERT
WITH CHECK (
  auth.uid() = user_id OR 
  (is_shared = true AND share_token IS NOT NULL)
);

CREATE POLICY "Users can update their own QA sessions"
ON public.qa_sessions
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own QA sessions"
ON public.qa_sessions
FOR DELETE
USING (auth.uid() = user_id);

-- CRITICAL SECURITY FIX 4: Add session authorization column and update table
ALTER TABLE public.qa_sessions 
ADD COLUMN IF NOT EXISTS authorized_access boolean DEFAULT false;

-- CRITICAL SECURITY FIX 5: Create function to securely verify session access
CREATE OR REPLACE FUNCTION public.verify_session_access(
  session_id_param uuid,
  share_token_param text DEFAULT NULL,
  user_password_param text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  session_record RECORD;
  agent_record RECORD;
BEGIN
  -- Get session details
  SELECT user_id, agent_id, is_shared, share_token
  INTO session_record
  FROM public.qa_sessions
  WHERE id = session_id_param;
  
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  
  -- For non-shared sessions, verify user ownership
  IF NOT session_record.is_shared THEN
    RETURN auth.uid() = session_record.user_id;
  END IF;
  
  -- For shared sessions, validate agent access
  IF session_record.share_token IS NOT NULL THEN
    RETURN validate_shared_agent_access(
      session_record.agent_id, 
      session_record.share_token, 
      user_password_param
    );
  END IF;
  
  RETURN false;
END;
$$;