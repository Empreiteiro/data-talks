-- Fix security vulnerability: Strengthen RLS policies for alerts table
-- Issue: User email addresses could be harvested by attackers

-- Drop existing policy to recreate with stronger restrictions
DROP POLICY IF EXISTS "Users can manage their own alerts" ON public.alerts;

-- Create more restrictive policies that prevent email harvesting
-- Users can only view their own alert metadata (without exposing emails to other users)
CREATE POLICY "Users can view their own alerts" 
ON public.alerts 
FOR SELECT 
USING (auth.uid() = user_id);

-- Users can only insert alerts for themselves
CREATE POLICY "Users can create their own alerts" 
ON public.alerts 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- Users can only update their own alerts
CREATE POLICY "Users can update their own alerts" 
ON public.alerts 
FOR UPDATE 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Users can only delete their own alerts
CREATE POLICY "Users can delete their own alerts" 
ON public.alerts 
FOR DELETE 
USING (auth.uid() = user_id);

-- Additional security: Create a view that masks sensitive data for non-owners
-- This provides an extra layer of protection against potential policy bypasses
CREATE OR REPLACE VIEW public.alerts_safe AS
SELECT 
  id,
  user_id,
  agent_id,
  name,
  question,
  frequency,
  CASE 
    WHEN auth.uid() = user_id THEN email
    ELSE NULL
  END as email,
  next_run,
  created_at
FROM public.alerts
WHERE auth.uid() = user_id;