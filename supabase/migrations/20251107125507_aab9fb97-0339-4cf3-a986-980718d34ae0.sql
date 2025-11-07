-- Drop todas as políticas de UPDATE atuais
DROP POLICY IF EXISTS "Users can soft delete their own QA sessions" ON public.qa_sessions;
DROP POLICY IF EXISTS "Users and org members can update QA sessions content" ON public.qa_sessions;

-- Criar UMA ÚNICA política PERMISSIVE que cobre ambos os casos:
-- 1. Soft delete (owner muda deleted_at de NULL para NOT NULL)
-- 2. Content update (owner ou org member atualiza outros campos)
CREATE POLICY "Users and org members can update QA sessions"
ON public.qa_sessions
AS PERMISSIVE
FOR UPDATE
USING (
  -- Permite acesso se:
  -- - É o owner OU
  -- - É membro da mesma organização do agente
  (auth.uid() = user_id OR 
   EXISTS (
     SELECT 1 FROM public.agents
     WHERE agents.id = qa_sessions.agent_id
       AND agents.organization_id = user_organization_id(auth.uid())
   ))
  -- E a sessão não está deletada (antes do update)
  AND deleted_at IS NULL
)
WITH CHECK (
  -- Após o update, permite se:
  -- - É o owner
  auth.uid() = user_id
  -- E qualquer um destes estados:
  -- - Continua não deletado (content update) OU
  -- - Foi soft deletado (soft delete)
  -- Sem restrição explícita em deleted_at no WITH CHECK
);