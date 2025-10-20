-- Migração para associar usuários e workspaces existentes a organizações

-- 1. Para cada user_role existente sem organização, criar uma organização
DO $$
DECLARE
  user_role_record RECORD;
  new_org_id UUID;
  user_email TEXT;
BEGIN
  FOR user_role_record IN 
    SELECT DISTINCT user_id 
    FROM user_roles 
    WHERE organization_id IS NULL
  LOOP
    -- Buscar email do usuário para criar nome da organização
    SELECT email INTO user_email
    FROM auth.users
    WHERE id = user_role_record.user_id;
    
    -- Criar nova organização
    INSERT INTO organizations (name)
    VALUES (COALESCE(user_email, 'Organização'))
    RETURNING id INTO new_org_id;
    
    -- Atualizar todos os user_roles deste usuário
    UPDATE user_roles
    SET organization_id = new_org_id
    WHERE user_id = user_role_record.user_id
      AND organization_id IS NULL;
    
    -- Atualizar todos os agents (workspaces) deste usuário
    UPDATE agents
    SET organization_id = new_org_id
    WHERE user_id = user_role_record.user_id
      AND organization_id IS NULL;
  END LOOP;
END $$;

-- 2. Para agents que ainda estão sem organização (órfãos ou de usuários que não estão em user_roles)
-- Associar à primeira organização ou criar uma genérica
DO $$
DECLARE
  default_org_id UUID;
  agent_record RECORD;
  agent_user_org UUID;
BEGIN
  FOR agent_record IN 
    SELECT id, user_id 
    FROM agents 
    WHERE organization_id IS NULL
  LOOP
    -- Verificar se o user_id do agent tem uma organização em user_roles
    SELECT organization_id INTO agent_user_org
    FROM user_roles
    WHERE user_id = agent_record.user_id
    LIMIT 1;
    
    -- Se encontrou organização do usuário, usar ela
    IF agent_user_org IS NOT NULL THEN
      UPDATE agents
      SET organization_id = agent_user_org
      WHERE id = agent_record.id;
    ELSE
      -- Se não encontrou, pegar ou criar organização padrão
      SELECT id INTO default_org_id FROM organizations LIMIT 1;
      
      IF default_org_id IS NULL THEN
        INSERT INTO organizations (name)
        VALUES ('Organização Padrão')
        RETURNING id INTO default_org_id;
      END IF;
      
      UPDATE agents
      SET organization_id = default_org_id
      WHERE id = agent_record.id;
    END IF;
  END LOOP;
END $$;

-- 3. Tornar organization_id obrigatório após migração dos dados existentes
ALTER TABLE user_roles ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE agents ALTER COLUMN organization_id SET NOT NULL;