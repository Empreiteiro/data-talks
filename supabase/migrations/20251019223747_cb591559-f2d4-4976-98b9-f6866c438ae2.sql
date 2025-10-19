-- Drop policies that depend on share_token
DROP POLICY IF EXISTS "Users can create their own QA sessions" ON public.qa_sessions;
DROP POLICY IF EXISTS "Users can view their own QA sessions" ON public.qa_sessions;

-- Recreate the policies without share_token dependency
CREATE POLICY "Users can create their own QA sessions" ON public.qa_sessions
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own QA sessions" ON public.qa_sessions
FOR SELECT 
USING (auth.uid() = user_id);

-- Now drop the columns
ALTER TABLE public.agents
DROP COLUMN IF EXISTS share_token,
DROP COLUMN IF EXISTS share_password;

ALTER TABLE public.qa_sessions
DROP COLUMN IF EXISTS share_token,
DROP COLUMN IF EXISTS is_shared;

-- Drop sharing-related functions
DROP FUNCTION IF EXISTS public.get_agent_share_token(uuid);
DROP FUNCTION IF EXISTS public.update_agent_sharing(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.update_agent_share_password_only(uuid, text);
DROP FUNCTION IF EXISTS public.get_shared_agent_safe_fields(text);
DROP FUNCTION IF EXISTS public.verify_agent_share_password(text, text);
DROP FUNCTION IF EXISTS public.get_shared_agent_qa_sessions(text);
DROP FUNCTION IF EXISTS public.validate_shared_agent_access(uuid, text, text);
DROP FUNCTION IF EXISTS public.hash_password(text);
DROP FUNCTION IF EXISTS public.verify_password(text, text);
DROP FUNCTION IF EXISTS public.block_sensitive_agent_columns();
DROP FUNCTION IF EXISTS public.verify_session_access(uuid, text, text);