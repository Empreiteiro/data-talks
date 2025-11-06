-- Drop the current consolidated UPDATE policy
DROP POLICY IF EXISTS "Users and org members can update QA sessions" ON public.qa_sessions;

-- Create specific policy for soft delete operations
CREATE POLICY "Users can soft delete their own QA sessions"
ON public.qa_sessions
FOR UPDATE
USING (
  auth.uid() = user_id 
  AND deleted_at IS NULL
)
WITH CHECK (
  auth.uid() = user_id 
  AND deleted_at IS NOT NULL
);

-- Create policy for regular content updates (not soft delete)
CREATE POLICY "Users and org members can update QA sessions content"
ON public.qa_sessions
FOR UPDATE
USING (
  (auth.uid() = user_id OR 
   EXISTS (
     SELECT 1 FROM public.agents
     WHERE agents.id = qa_sessions.agent_id
       AND agents.organization_id = user_organization_id(auth.uid())
   ))
  AND deleted_at IS NULL
)
WITH CHECK (
  deleted_at IS NULL
);