-- Fix RLS policies for qa_sessions soft delete
-- Remove conflicting policies that cause the 42501 error

DROP POLICY IF EXISTS "Users can soft delete their own QA sessions" ON public.qa_sessions;
DROP POLICY IF EXISTS "Users and org members can update QA sessions content" ON public.qa_sessions;

-- Create a single, comprehensive UPDATE policy that handles both cases
CREATE POLICY "Users and org members can update QA sessions"
ON public.qa_sessions
FOR UPDATE
USING (
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
)
WITH CHECK (
  -- Same permission check for the updated row
  auth.uid() = user_id
  OR
  EXISTS (
    SELECT 1 
    FROM public.agents
    WHERE agents.id = qa_sessions.agent_id
      AND agents.organization_id = user_organization_id(auth.uid())
  )
);

-- Note: No restriction on deleted_at in WITH CHECK allows soft delete to work
-- The USING clause allows access to both deleted and non-deleted records for updates
