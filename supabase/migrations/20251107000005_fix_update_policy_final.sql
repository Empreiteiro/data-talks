-- FINAL FIX: Remove WITH CHECK from UPDATE policy to allow soft delete
-- The WITH CHECK was causing the "new row violates RLS" error because
-- after soft delete (deleted_at IS NOT NULL), the SELECT policies can't see the row

-- Drop the problematic UPDATE policy
DROP POLICY IF EXISTS "Users and org members can update QA sessions" ON public.qa_sessions;

-- Create UPDATE policy WITHOUT WITH CHECK clause
-- This allows soft delete to work because we don't validate the updated row
CREATE POLICY "Users and org members can update QA sessions"
ON public.qa_sessions
FOR UPDATE
USING (
  -- User owns the session OR is member of the organization
  auth.uid() = user_id 
  OR 
  EXISTS (
    SELECT 1 
    FROM public.agents
    WHERE agents.id = qa_sessions.agent_id
      AND agents.organization_id = user_organization_id(auth.uid())
  )
);
-- NO WITH CHECK clause - this is the key fix!
