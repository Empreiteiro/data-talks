-- Remover a política atual que só verifica user_id
DROP POLICY IF EXISTS "Users can create their own agents" ON public.agents;

-- Criar nova política que valida tanto user_id quanto organization_id
CREATE POLICY "Users can create agents in their organization" 
ON public.agents 
FOR INSERT 
WITH CHECK (
  auth.uid() = user_id 
  AND organization_id = user_organization_id(auth.uid())
);