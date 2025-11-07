-- Fix sources table policies to allow BigQuery source creation
-- The current policy is too restrictive and blocks source creation

-- Check current policies for sources table
-- Current policy: "Organization members can manage sources" FOR ALL USING (user_belongs_to_organization(auth.uid(), organization_id))

-- The problem is that the BigQuery connect function tries to INSERT without organization_id
-- But organization_id is NOT NULL, so we need to either:
-- 1. Make organization_id nullable temporarily, or
-- 2. Update the edge function to include organization_id

-- Let's update the policy to be more specific and allow INSERT with proper organization_id
DROP POLICY IF EXISTS "Organization members can manage sources" ON public.sources;

-- Create separate policies for different operations
CREATE POLICY "Users can view sources from their organization"
ON public.sources
FOR SELECT
USING (user_belongs_to_organization(auth.uid(), organization_id));

-- Allow users to create sources in their organization
CREATE POLICY "Users can create sources in their organization"
ON public.sources
FOR INSERT
WITH CHECK (
  -- User must be authenticated
  auth.uid() IS NOT NULL
  AND
  -- If organization_id is provided, user must belong to it
  (organization_id IS NULL OR user_belongs_to_organization(auth.uid(), organization_id))
);

-- Allow users to update sources in their organization
CREATE POLICY "Users can update sources in their organization"
ON public.sources
FOR UPDATE
USING (user_belongs_to_organization(auth.uid(), organization_id))
WITH CHECK (user_belongs_to_organization(auth.uid(), organization_id));

-- Allow users to delete sources in their organization
CREATE POLICY "Users can delete sources in their organization"
ON public.sources
FOR DELETE
USING (user_belongs_to_organization(auth.uid(), organization_id));

-- Also create a trigger to automatically set organization_id on INSERT if not provided
CREATE OR REPLACE FUNCTION public.set_source_organization_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If organization_id is not set, get it from the user's organization
  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := user_organization_id(auth.uid());
  END IF;
  
  -- Ensure organization_id is set (required field)
  IF NEW.organization_id IS NULL THEN
    RAISE EXCEPTION 'Cannot determine user organization for source creation';
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger to auto-set organization_id
DROP TRIGGER IF EXISTS set_source_organization_id_trigger ON public.sources;
CREATE TRIGGER set_source_organization_id_trigger
  BEFORE INSERT ON public.sources
  FOR EACH ROW
  EXECUTE FUNCTION public.set_source_organization_id();
