-- Remove função get_user_agents_safe que ainda referencia share_token
DROP FUNCTION IF EXISTS public.get_user_agents_safe();