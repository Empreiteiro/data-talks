-- Fix Security Definer View issue
-- The agents_safe view was created with implicit SECURITY DEFINER behavior
-- Since we're already using secure functions (get_user_agents_safe), we can safely drop this view

-- Drop the problematic view
DROP VIEW IF EXISTS public.agents_safe;

-- The view is not needed since we're using the secure function get_user_agents_safe()
-- This eliminates the security definer issue while maintaining all functionality