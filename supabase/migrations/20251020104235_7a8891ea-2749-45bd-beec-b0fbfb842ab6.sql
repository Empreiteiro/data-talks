
-- Criar organização para democh@datax.dev
INSERT INTO public.organizations (name)
VALUES ('democh@datax.dev');

-- Associar o usuário à sua organização como admin
INSERT INTO public.user_roles (user_id, role, organization_id, created_by)
SELECT 
  'ddbbc583-c5e9-4497-8749-6bd84b9e35af'::uuid,
  'admin'::app_role,
  o.id,
  'ddbbc583-c5e9-4497-8749-6bd84b9e35af'::uuid
FROM public.organizations o
WHERE o.name = 'democh@datax.dev';

-- Atualizar agentes criados por este usuário para associá-los à organização
UPDATE public.agents
SET organization_id = (SELECT id FROM public.organizations WHERE name = 'democh@datax.dev')
WHERE user_id = 'ddbbc583-c5e9-4497-8749-6bd84b9e35af'::uuid
  AND organization_id IS NULL;
