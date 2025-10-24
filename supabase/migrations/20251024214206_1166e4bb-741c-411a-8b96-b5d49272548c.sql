-- Simplify UPDATE policy to allow soft delete without recursive checks
DROP POLICY IF EXISTS "Organization members can update QA sessions" ON public.qa_sessions;

-- Recreate without WITH CHECK to avoid recursion issues
CREATE POLICY "Organization members can update QA sessions" 
ON public.qa_sessions 
FOR UPDATE 
USING (
  EXISTS (
    SELECT 1
    FROM agents
    WHERE agents.id = qa_sessions.agent_id
      AND agents.organization_id = user_organization_id(auth.uid())
  )
);