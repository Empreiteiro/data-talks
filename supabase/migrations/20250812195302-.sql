-- Create a security function to validate email access
CREATE OR REPLACE FUNCTION public.can_access_alert_email(alert_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  -- Only the alert owner can see their email
  RETURN auth.uid() = alert_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Add an additional RLS policy for extra email protection
CREATE POLICY "Email field protection" 
ON public.alerts 
FOR SELECT 
USING (
  auth.uid() = user_id AND 
  public.can_access_alert_email(user_id)
);