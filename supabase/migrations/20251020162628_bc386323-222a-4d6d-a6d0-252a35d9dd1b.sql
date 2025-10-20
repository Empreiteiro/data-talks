-- Teste para verificar o problema
-- Vamos verificar se a policy atual está funcionando

-- Primeiro, vamos ver o que a função retorna para o usuário logado
SELECT is_organization_admin(
  '9db8c95d-d77c-4481-9119-b2fd3746a646'::uuid,
  '658cd9c0-db9a-4b61-9175-854679a03b54'::uuid
) as is_admin;

-- Agora vamos simplificar a policy de INSERT para agents
-- O problema é que estamos verificando agents.organization_id dentro da policy
-- mas o "agents" ainda não existe no contexto do INSERT

DROP POLICY IF EXISTS "Organization admins can create agents" ON public.agents;

CREATE POLICY "Organization admins can create agents" 
ON public.agents 
FOR INSERT 
WITH CHECK (
  -- Verificar se o usuário é admin da organização que está sendo inserida
  is_organization_admin(auth.uid(), organization_id)
);