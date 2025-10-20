-- Criar trigger para adicionar automaticamente usuários em user_roles ao se cadastrarem
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_role();

-- Corrigir o usuário lucas.democh@portao3.com.br que já foi criado
-- Criar organização para ele
INSERT INTO public.organizations (name)
VALUES ('lucas.democh@portao3.com.br')
ON CONFLICT DO NOTHING;

-- Adicionar usuário como admin da nova organização
INSERT INTO public.user_roles (user_id, role, organization_id, created_by)
SELECT 
  '36db4261-1bfd-4958-a1c2-20d61b26dfef'::uuid,
  'admin'::app_role,
  o.id,
  '36db4261-1bfd-4958-a1c2-20d61b26dfef'::uuid
FROM public.organizations o
WHERE o.name = 'lucas.democh@portao3.com.br'
ON CONFLICT DO NOTHING;