-- Criar tabela de organizações
CREATE TABLE public.organizations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- Adicionar organization_id à tabela user_roles
ALTER TABLE public.user_roles ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

-- Adicionar organization_id à tabela agents (workspaces)
ALTER TABLE public.agents ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

-- Criar índices para melhor performance
CREATE INDEX idx_user_roles_organization ON public.user_roles(organization_id);
CREATE INDEX idx_agents_organization ON public.agents(organization_id);

-- Função para verificar se usuário pertence a uma organização
CREATE OR REPLACE FUNCTION public.user_organization_id(_user_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id 
  FROM public.user_roles 
  WHERE user_id = _user_id 
  LIMIT 1
$$;

-- Função para verificar se usuário é admin da organização
CREATE OR REPLACE FUNCTION public.is_organization_admin(_user_id UUID, _organization_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND organization_id = _organization_id
      AND role = 'admin'
  )
$$;

-- RLS Policies para organizations
CREATE POLICY "Users can view their organization"
  ON public.organizations
  FOR SELECT
  USING (id = user_organization_id(auth.uid()));

CREATE POLICY "Admins can update their organization"
  ON public.organizations
  FOR UPDATE
  USING (is_organization_admin(auth.uid(), id));

-- Atualizar RLS policies da tabela agents para respeitar organizações
DROP POLICY IF EXISTS "Admins can create agents" ON public.agents;
DROP POLICY IF EXISTS "Admins can delete agents" ON public.agents;
DROP POLICY IF EXISTS "Admins can update all agents" ON public.agents;
DROP POLICY IF EXISTS "Users can view their own agents" ON public.agents;
DROP POLICY IF EXISTS "Users can view shared agents" ON public.agents;
DROP POLICY IF EXISTS "Owners can update their agents" ON public.agents;

-- Novos policies com isolamento por organização
CREATE POLICY "Organization admins can create agents"
  ON public.agents
  FOR INSERT
  WITH CHECK (
    organization_id = user_organization_id(auth.uid()) 
    AND is_organization_admin(auth.uid(), organization_id)
  );

CREATE POLICY "Organization admins can delete agents"
  ON public.agents
  FOR DELETE
  USING (
    organization_id = user_organization_id(auth.uid())
    AND is_organization_admin(auth.uid(), organization_id)
  );

CREATE POLICY "Organization admins can update agents"
  ON public.agents
  FOR UPDATE
  USING (
    organization_id = user_organization_id(auth.uid())
    AND is_organization_admin(auth.uid(), organization_id)
  );

CREATE POLICY "Users can view agents from their organization"
  ON public.agents
  FOR SELECT
  USING (organization_id = user_organization_id(auth.uid()));

-- Remover trigger antigo com CASCADE
DROP TRIGGER IF EXISTS on_auth_user_created_role ON auth.users CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_user_role() CASCADE;

-- Criar nova função para criar primeira organização e admin
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_org_id UUID;
BEGIN
  -- Verificar se é o primeiro usuário (primeira organização)
  IF NOT EXISTS (SELECT 1 FROM public.organizations LIMIT 1) THEN
    -- Criar primeira organização
    INSERT INTO public.organizations (name)
    VALUES ('Minha Organização')
    RETURNING id INTO new_org_id;
    
    -- Primeiro usuário vira admin da primeira organização
    INSERT INTO public.user_roles (user_id, role, organization_id, created_by)
    VALUES (NEW.id, 'admin', new_org_id, NEW.id);
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_role
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_role();

-- Atualizar policies de user_roles para respeitar organização
DROP POLICY IF EXISTS "Admins can create roles" ON public.user_roles;
DROP POLICY IF EXISTS "Organization admins can create roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can delete roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;

CREATE POLICY "Organization admins can create roles"
  ON public.user_roles
  FOR INSERT
  WITH CHECK (
    organization_id = user_organization_id(auth.uid())
    AND is_organization_admin(auth.uid(), organization_id)
  );

CREATE POLICY "Organization admins can delete roles"
  ON public.user_roles
  FOR DELETE
  USING (
    organization_id = user_organization_id(auth.uid())
    AND is_organization_admin(auth.uid(), organization_id)
  );

CREATE POLICY "Organization admins can view roles from their org"
  ON public.user_roles
  FOR SELECT
  USING (organization_id = user_organization_id(auth.uid()));

-- Atualizar workspace_users policies
DROP POLICY IF EXISTS "Workspace owners can grant access" ON public.workspace_users;
DROP POLICY IF EXISTS "Workspace owners can revoke access" ON public.workspace_users;
DROP POLICY IF EXISTS "Workspace owners can view access to their workspaces" ON public.workspace_users;

CREATE POLICY "Organization admins can grant workspace access"
  ON public.workspace_users
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.agents
      WHERE id = workspace_users.workspace_id
        AND organization_id = user_organization_id(auth.uid())
        AND is_organization_admin(auth.uid(), organization_id)
    )
  );

CREATE POLICY "Organization admins can revoke workspace access"
  ON public.workspace_users
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.agents
      WHERE id = workspace_users.workspace_id
        AND organization_id = user_organization_id(auth.uid())
        AND is_organization_admin(auth.uid(), organization_id)
    )
  );

CREATE POLICY "Organization admins can view workspace access"
  ON public.workspace_users
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.agents
      WHERE id = workspace_users.workspace_id
        AND organization_id = user_organization_id(auth.uid())
    )
  );

-- Atualizar sources policies para organização
DROP POLICY IF EXISTS "Admins can manage sources" ON public.sources;

CREATE POLICY "Organization admins can manage sources"
  ON public.sources
  FOR ALL
  USING (
    is_organization_admin(auth.uid(), user_organization_id(auth.uid()))
  );

-- Atualizar qa_sessions policies
DROP POLICY IF EXISTS "Users can view QA sessions from accessible workspaces" ON public.qa_sessions;

CREATE POLICY "Users can view QA sessions from their organization"
  ON public.qa_sessions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.agents
      WHERE id = qa_sessions.agent_id
        AND organization_id = user_organization_id(auth.uid())
    )
  );