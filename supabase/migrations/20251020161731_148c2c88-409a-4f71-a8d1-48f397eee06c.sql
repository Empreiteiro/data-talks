-- Debug: Let's check what's happening with the RLS policy
-- First, let's see if the function is working correctly

-- Test the is_organization_admin function
DO $$
DECLARE
  test_user_id uuid;
  test_org_id uuid;
  result boolean;
BEGIN
  -- Get a test admin user and their org
  SELECT user_id, organization_id 
  INTO test_user_id, test_org_id
  FROM user_roles 
  WHERE role = 'admin' 
  LIMIT 1;
  
  IF test_user_id IS NOT NULL THEN
    -- Test the function
    SELECT is_organization_admin(test_user_id, test_org_id) INTO result;
    RAISE NOTICE 'Test for user % and org %: %', test_user_id, test_org_id, result;
  END IF;
END $$;

-- Now let's recreate the policy with better error handling
DROP POLICY IF EXISTS "Organization admins can create agents" ON public.agents;

CREATE POLICY "Organization admins can create agents" 
ON public.agents 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.organization_id = agents.organization_id
      AND ur.role = 'admin'
  )
);