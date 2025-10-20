-- Remover a política atual
DROP POLICY IF EXISTS "Users can create agents in their organization" ON public.agents;

-- Criar política mais permissiva que permite criar agents desde que:
-- 1. O user_id seja o usuário autenticado
-- 2. O organization_id exista na tabela user_roles para esse usuário
CREATE POLICY "Users can create agents" 
ON public.agents 
FOR INSERT 
WITH CHECK (
  auth.uid() = user_id 
  AND EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_roles.user_id = auth.uid() 
    AND user_roles.organization_id = agents.organization_id
  )
);