-- Create security definer function to count user agents (bypasses RLS)
CREATE OR REPLACE FUNCTION public.count_user_agents(_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM public.agents
  WHERE user_id = _user_id
$$;

-- Update enforce_agents_limit to use the new function
CREATE OR REPLACE FUNCTION public.enforce_agents_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  is_subscribed boolean := false;
  tier text := NULL;
  limit_val integer;
  cur_count integer;
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(s.subscribed, false), s.subscription_tier
  INTO is_subscribed, tier
  FROM public.subscribers s
  WHERE s.user_id = NEW.user_id
  ORDER BY s.updated_at DESC
  LIMIT 1;

  IF is_subscribed = true AND tier = 'Pro' THEN
    limit_val := 20;
  ELSE
    limit_val := 5;
  END IF;

  -- Use the new count_user_agents function instead of direct SELECT
  cur_count := count_user_agents(NEW.user_id);

  IF cur_count >= limit_val THEN
    RAISE EXCEPTION 'Limite do plano atingido: máximo de % agente(s) no seu plano atual.', limit_val
      USING ERRCODE = 'check_violation',
            HINT = 'Atualize para o plano Pro para aumentar o limite de agentes.';
  END IF;

  RETURN NEW;
END;
$function$;