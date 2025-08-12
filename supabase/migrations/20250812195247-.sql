-- Create a secure view for alerts that protects email addresses
CREATE OR REPLACE VIEW public.alerts_secure AS
SELECT 
  id,
  user_id,
  agent_id,
  name,
  question,
  frequency,
  next_run,
  created_at,
  -- Only show email to the owner of the alert
  CASE 
    WHEN auth.uid() = user_id THEN email 
    ELSE NULL 
  END as email
FROM public.alerts;

-- Grant SELECT permissions on the view
GRANT SELECT ON public.alerts_secure TO authenticated;

-- Enable RLS on the view
ALTER VIEW public.alerts_secure SET (security_barrier = true);

-- Create RLS policy for the secure view
CREATE POLICY "Users can view alerts securely" 
ON public.alerts_secure 
FOR SELECT 
USING (auth.uid() = user_id);