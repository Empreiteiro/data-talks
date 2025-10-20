-- Atualizar o role do usuário para admin
UPDATE public.user_roles 
SET role = 'admin'
WHERE user_id = '9a893a8a-186e-4a80-8247-efc3286b3f38';

-- Adicionar policy para permitir que usuários criem seus próprios workspaces
DROP POLICY IF EXISTS "Users can create their own agents" ON public.agents;

CREATE POLICY "Users can create their own agents" 
ON public.agents 
FOR INSERT 
WITH CHECK (
  auth.uid() = user_id
);