-- Drop da política de content update atual que tem WITH CHECK conflitante
DROP POLICY IF EXISTS "Users and org members can update QA sessions content" ON public.qa_sessions;

-- Recriar SEM o WITH CHECK que causa conflito com soft delete
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
);
-- Sem WITH CHECK - permite que soft delete funcione sem conflito