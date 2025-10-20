-- Remover a política restritiva que está bloqueando a criação
DROP POLICY IF EXISTS "Organization admins can create agents" ON public.agents;

-- A política "Users can create their own agents" já existe e é suficiente
-- Ela permite que qualquer usuário autenticado crie agents desde que user_id = auth.uid()