-- Fix the security definer view issue
-- Remove the view and replace with proper RLS-only approach

-- Drop the problematic view
DROP VIEW IF EXISTS public.alerts_safe;

-- The RLS policies we created are sufficient for security
-- No need for a security definer view - RLS handles the access control properly