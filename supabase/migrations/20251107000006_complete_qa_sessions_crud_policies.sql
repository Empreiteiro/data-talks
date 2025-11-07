-- Complete CRUD policies for qa_sessions table
-- This replaces all existing policies with a comprehensive set that works

-- Remove ALL existing policies first
DROP POLICY IF EXISTS "Users and org members can create QA sessions" ON public.qa_sessions;
DROP POLICY IF EXISTS "Users can view QA sessions from their organization" ON public.qa_sessions;
DROP POLICY IF EXISTS "Users can view their own QA sessions" ON public.qa_sessions;
DROP POLICY IF EXISTS "Users and org members can update QA sessions" ON public.qa_sessions;
DROP POLICY IF EXISTS "Simple: Users can view own sessions" ON public.qa_sessions;
DROP POLICY IF EXISTS "Simple: Users can create own sessions" ON public.qa_sessions;
DROP POLICY IF EXISTS "Simple: Users can update own sessions" ON public.qa_sessions;
DROP POLICY IF EXISTS "Simple: Users can delete own sessions" ON public.qa_sessions;

-- CREATE (INSERT) Policy
-- Users can create sessions for themselves or for agents in their organization
CREATE POLICY "qa_sessions_insert_policy"
ON public.qa_sessions
FOR INSERT
WITH CHECK (
  -- User is creating for themselves
  auth.uid() = user_id
  OR
  -- User is member of the organization that owns the agent
  EXISTS (
    SELECT 1 FROM public.agents
    WHERE agents.id = qa_sessions.agent_id
      AND agents.organization_id = user_organization_id(auth.uid())
  )
);

-- READ (SELECT) Policy  
-- Users can view their own sessions or sessions from their organization (non-deleted)
CREATE POLICY "qa_sessions_select_policy"
ON public.qa_sessions
FOR SELECT
USING (
  (
    -- Own sessions
    auth.uid() = user_id
    OR
    -- Organization sessions
    EXISTS (
      SELECT 1 FROM public.agents
      WHERE agents.id = qa_sessions.agent_id
        AND agents.organization_id = user_organization_id(auth.uid())
    )
  )
  AND deleted_at IS NULL  -- Only show non-deleted sessions
);

-- UPDATE Policy
-- Users can update their own sessions or sessions from their organization
-- CRITICAL: No WITH CHECK clause to allow soft delete
CREATE POLICY "qa_sessions_update_policy"
ON public.qa_sessions
FOR UPDATE
USING (
  -- User owns the session
  auth.uid() = user_id
  OR
  -- User is member of the organization that owns the agent
  EXISTS (
    SELECT 1 FROM public.agents
    WHERE agents.id = qa_sessions.agent_id
      AND agents.organization_id = user_organization_id(auth.uid())
  )
);
-- NO WITH CHECK clause - this is critical for soft delete to work!

-- DELETE Policy (if hard delete is ever needed)
-- Users can delete their own sessions or sessions from their organization
CREATE POLICY "qa_sessions_delete_policy"
ON public.qa_sessions
FOR DELETE
USING (
  -- User owns the session
  auth.uid() = user_id
  OR
  -- User is member of the organization that owns the agent
  EXISTS (
    SELECT 1 FROM public.agents
    WHERE agents.id = qa_sessions.agent_id
      AND agents.organization_id = user_organization_id(auth.uid())
  )
);
