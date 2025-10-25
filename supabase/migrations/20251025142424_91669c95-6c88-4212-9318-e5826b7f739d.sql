-- Consolidate UPDATE policies to fix soft delete
-- Remove the two separate UPDATE policies
DROP POLICY IF EXISTS "Users can update their own QA sessions" ON public.qa_sessions;
DROP POLICY IF EXISTS "Organization members can update QA sessions" ON public.qa_sessions;

-- Create single consolidated policy with explicit OR logic
-- This allows both owners and org members to update, including soft delete
CREATE POLICY "Users and org members can update QA sessions" 
ON public.qa_sessions 
FOR UPDATE 
USING (
  -- Session owner can update
  auth.uid() = user_id
  OR
  -- Or organization members of the agent can update
  EXISTS (
    SELECT 1
    FROM agents
    WHERE agents.id = qa_sessions.agent_id
      AND agents.organization_id = user_organization_id(auth.uid())
  )
);
-- No WITH CHECK clause to allow soft delete (setting deleted_at)