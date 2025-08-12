-- Fix the search path issue in the function
CREATE OR REPLACE FUNCTION public.can_access_alert_email(alert_user_id UUID)
RETURNS BOOLEAN 
LANGUAGE plpgsql 
SECURITY DEFINER 
STABLE
SET search_path = public, auth
AS $$
BEGIN
  -- Only the alert owner can see their email
  RETURN auth.uid() = alert_user_id;
END;
$$;