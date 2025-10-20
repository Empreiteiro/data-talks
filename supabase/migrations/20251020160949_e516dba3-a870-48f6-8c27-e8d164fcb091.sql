-- Fix RLS policy for agents INSERT
-- The current policy is too restrictive, causing issues when admins try to create agents

DROP POLICY IF EXISTS "Organization admins can create agents" ON public.agents;

CREATE POLICY "Organization admins can create agents" 
ON public.agents 
FOR INSERT 
WITH CHECK (
  -- Check if the user is admin of the organization being assigned to the agent
  is_organization_admin(auth.uid(), organization_id)
);