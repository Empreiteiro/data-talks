-- Add organization_id to sources table
ALTER TABLE public.sources 
ADD COLUMN organization_id uuid;

-- Populate organization_id for existing sources using user's organization
UPDATE public.sources 
SET organization_id = user_organization_id(user_id)
WHERE organization_id IS NULL;

-- Make organization_id NOT NULL and add foreign key
ALTER TABLE public.sources 
ALTER COLUMN organization_id SET NOT NULL,
ADD CONSTRAINT sources_organization_id_fkey 
  FOREIGN KEY (organization_id) 
  REFERENCES public.organizations(id) 
  ON DELETE CASCADE;

-- Add organization_id to subscribers table
ALTER TABLE public.subscribers 
ADD COLUMN organization_id uuid;

-- Populate organization_id for existing subscribers using user's organization
UPDATE public.subscribers 
SET organization_id = user_organization_id(user_id)
WHERE organization_id IS NULL AND user_id IS NOT NULL;

-- Make organization_id NOT NULL and add foreign key
ALTER TABLE public.subscribers 
ALTER COLUMN organization_id SET NOT NULL,
ADD CONSTRAINT subscribers_organization_id_fkey 
  FOREIGN KEY (organization_id) 
  REFERENCES public.organizations(id) 
  ON DELETE CASCADE;

-- Update RLS policy for sources to use organization_id
DROP POLICY IF EXISTS "Organization admins can manage sources" ON public.sources;

CREATE POLICY "Organization members can manage sources" 
ON public.sources 
FOR ALL 
USING (user_belongs_to_organization(auth.uid(), organization_id));

-- Update RLS policies for subscribers
DROP POLICY IF EXISTS "select_own_subscription" ON public.subscribers;
DROP POLICY IF EXISTS "update_own_subscription" ON public.subscribers;
DROP POLICY IF EXISTS "insert_subscription" ON public.subscribers;

CREATE POLICY "Users can view their organization subscriptions" 
ON public.subscribers 
FOR SELECT 
USING (user_belongs_to_organization(auth.uid(), organization_id) OR email = auth.email());

CREATE POLICY "Users can update their organization subscriptions" 
ON public.subscribers 
FOR UPDATE 
USING (user_belongs_to_organization(auth.uid(), organization_id));

CREATE POLICY "Users can insert subscriptions for their organization" 
ON public.subscribers 
FOR INSERT 
WITH CHECK (user_belongs_to_organization(auth.uid(), organization_id));