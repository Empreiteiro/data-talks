-- Fix UPDATE policies for qa_sessions to allow soft delete with WITH CHECK
DROP POLICY IF EXISTS "Users can update their own QA sessions" ON public.qa_sessions;
DROP POLICY IF EXISTS "Organization members can update QA sessions" ON public.qa_sessions;

-- User can update their own sessions
CREATE POLICY "Users can update their own QA sessions" 
ON public.qa_sessions 
FOR UPDATE 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Organization members can update QA sessions
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
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM agents
    WHERE agents.id = qa_sessions.agent_id
      AND agents.organization_id = user_organization_id(auth.uid())
  )
);