-- Create enum for user roles
CREATE TYPE public.app_role AS ENUM ('admin', 'member');

-- Create user_roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  role public.app_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  UNIQUE(user_id, role)
);

-- Create workspace_users table (many-to-many relationship)
CREATE TABLE public.workspace_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  granted_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, user_id)
);

-- Enable RLS
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_users ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Create function to check workspace access
CREATE OR REPLACE FUNCTION public.can_access_workspace(_user_id UUID, _workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    -- User is owner
    SELECT 1 FROM public.agents WHERE id = _workspace_id AND user_id = _user_id
    UNION
    -- User has been granted access
    SELECT 1 FROM public.workspace_users WHERE workspace_id = _workspace_id AND user_id = _user_id
    UNION
    -- User is admin
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin'
  )
$$;

-- Create function to get user's primary role
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID)
RETURNS public.app_role
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE user_id = _user_id ORDER BY 
    CASE role 
      WHEN 'admin' THEN 1
      WHEN 'member' THEN 2
    END
  LIMIT 1
$$;

-- RLS Policies for user_roles
CREATE POLICY "Users can view their own role"
ON public.user_roles FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all roles"
ON public.user_roles FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can create roles"
ON public.user_roles FOR INSERT
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete roles"
ON public.user_roles FOR DELETE
USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for workspace_users
CREATE POLICY "Users can view their workspace access"
ON public.workspace_users FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all workspace access"
ON public.workspace_users FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Workspace owners can view access to their workspaces"
ON public.workspace_users FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.agents 
    WHERE id = workspace_id AND user_id = auth.uid()
  )
);

CREATE POLICY "Admins can grant workspace access"
ON public.workspace_users FOR INSERT
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Workspace owners can grant access"
ON public.workspace_users FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.agents 
    WHERE id = workspace_id AND user_id = auth.uid()
  )
);

CREATE POLICY "Admins can revoke workspace access"
ON public.workspace_users FOR DELETE
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Workspace owners can revoke access"
ON public.workspace_users FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.agents 
    WHERE id = workspace_id AND user_id = auth.uid()
  )
);

-- Update agents policies to consider workspace_users
DROP POLICY IF EXISTS "Users can view their agents (safe fields only)" ON public.agents;

CREATE POLICY "Users can view their own agents"
ON public.agents FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can view shared agents"
ON public.agents FOR SELECT
USING (public.can_access_workspace(auth.uid(), id));

-- Update agents policies for creation (only admins can create)
DROP POLICY IF EXISTS "Users can create their own agents" ON public.agents;

CREATE POLICY "Admins can create agents"
ON public.agents FOR INSERT
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Update agents policies for updates (only admins and owners)
DROP POLICY IF EXISTS "Users can update their own agents" ON public.agents;

CREATE POLICY "Admins can update all agents"
ON public.agents FOR UPDATE
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Owners can update their agents"
ON public.agents FOR UPDATE
USING (auth.uid() = user_id);

-- Update agents policies for deletion (only admins)
DROP POLICY IF EXISTS "Users can delete their own agents" ON public.agents;

CREATE POLICY "Admins can delete agents"
ON public.agents FOR DELETE
USING (public.has_role(auth.uid(), 'admin'));

-- Update sources policies (only admins can manage)
DROP POLICY IF EXISTS "Users can manage their own sources" ON public.sources;

CREATE POLICY "Admins can manage sources"
ON public.sources FOR ALL
USING (public.has_role(auth.uid(), 'admin'));

-- Update qa_sessions to ensure users only see their own conversations
DROP POLICY IF EXISTS "Users can view their own QA sessions" ON public.qa_sessions;

CREATE POLICY "Users can view their own QA sessions"
ON public.qa_sessions FOR SELECT
USING (
  auth.uid() = user_id 
  OR (is_shared = true AND share_token IS NOT NULL)
);

CREATE POLICY "Users can view QA sessions from accessible workspaces"
ON public.qa_sessions FOR SELECT
USING (
  auth.uid() = user_id 
  AND public.can_access_workspace(auth.uid(), agent_id)
);

-- Trigger to automatically create admin role for first user
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Check if this is the first user in user_roles
  IF NOT EXISTS (SELECT 1 FROM public.user_roles) THEN
    -- First user becomes admin
    INSERT INTO public.user_roles (user_id, role, created_by)
    VALUES (NEW.id, 'admin', NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_role
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_role();