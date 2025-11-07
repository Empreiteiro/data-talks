-- Drop ambas as políticas de UPDATE atuais
DROP POLICY IF EXISTS "Users can soft delete their own QA sessions" ON public.qa_sessions;
DROP POLICY IF EXISTS "Users and org members can update QA sessions content" ON public.qa_sessions;

-- Criar política RESTRITIVA específica para soft delete
-- Policies RESTRICTIVAS funcionam de forma independente e não precisam satisfazer outras políticas
CREATE POLICY "Users can soft delete their own QA sessions"
ON public.qa_sessions
AS RESTRICTIVE
FOR UPDATE
USING (
  auth.uid() = user_id 
  AND deleted_at IS NULL
)
WITH CHECK (
  auth.uid() = user_id 
  AND deleted_at IS NOT NULL
);

-- Criar política PERMISSIVA para updates gerais de conteúdo (sem WITH CHECK)
CREATE POLICY "Users and org members can update QA sessions content"
ON public.qa_sessions
AS PERMISSIVE
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