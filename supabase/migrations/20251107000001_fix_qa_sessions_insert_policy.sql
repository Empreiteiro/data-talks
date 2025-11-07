-- Fix INSERT policy for qa_sessions to allow organization members
-- This fixes the "new row violates row-level security policy" error during soft delete

DROP POLICY IF EXISTS "Users can create their own QA sessions" ON public.qa_sessions;

-- Create comprehensive INSERT policy that allows both user and organization members
CREATE POLICY "Users and org members can create QA sessions"
ON public.qa_sessions
FOR INSERT
WITH CHECK (
  -- User owns the session
  auth.uid() = user_id
  OR
  -- Or user is member of the organization that owns the agent
  EXISTS (
    SELECT 1 
    FROM public.agents
    WHERE agents.id = qa_sessions.agent_id
      AND agents.organization_id = user_organization_id(auth.uid())
  )
);

-- Also ensure we have the correct SELECT policies for organization members
DROP POLICY IF EXISTS "Users can view their own QA sessions" ON public.qa_sessions;
DROP POLICY IF EXISTS "Users can view QA sessions from their organization" ON public.qa_sessions;

-- Recreate SELECT policies with proper organization support
CREATE POLICY "Users can view their own QA sessions"
ON public.qa_sessions
FOR SELECT
USING (
  auth.uid() = user_id 
  AND deleted_at IS NULL
);

CREATE POLICY "Users can view QA sessions from their organization"
ON public.qa_sessions
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.agents
    WHERE agents.id = qa_sessions.agent_id
      AND agents.organization_id = user_organization_id(auth.uid())
  )
  AND deleted_at IS NULL
);
