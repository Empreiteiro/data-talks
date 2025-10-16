-- Update sources limit function
CREATE OR REPLACE FUNCTION public.enforce_sources_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  is_subscribed boolean := false;
  tier text := NULL;
  limit_val integer;
  cur_count integer;
BEGIN
  -- Segurança: requer user_id na linha
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Determina plano do usuário
  SELECT COALESCE(s.subscribed, false), s.subscription_tier
  INTO is_subscribed, tier
  FROM public.subscribers s
  WHERE s.user_id = NEW.user_id
  ORDER BY s.updated_at DESC
  LIMIT 1;

  -- Limites: Trial 5 fontes, Pro 10 fontes
  IF is_subscribed = true AND tier = 'Pro' THEN
    limit_val := 10; -- Pro: 10 fontes
  ELSE
    limit_val := 5; -- Trial: 5 fontes
  END IF;

  SELECT COUNT(*) INTO cur_count
  FROM public.sources
  WHERE user_id = NEW.user_id;

  IF cur_count >= limit_val THEN
    RAISE EXCEPTION 'Limite do plano atingido: máximo de % fonte(s) no seu plano atual.', limit_val
      USING ERRCODE = 'check_violation',
            HINT = 'Atualize para o plano Pro para aumentar o limite de fontes.';
  END IF;

  RETURN NEW;
END;
$function$;

-- Update agents limit function
CREATE OR REPLACE FUNCTION public.enforce_agents_limit()
RETURNS trigger
LANGUAGE plpgsql
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

  -- Limites: Trial 5 agentes, Pro 20 agentes
  IF is_subscribed = true AND tier = 'Pro' THEN
    limit_val := 20; -- Pro: 20 agentes
  ELSE
    limit_val := 5; -- Trial: 5 agentes
  END IF;

  SELECT COUNT(*) INTO cur_count
  FROM public.agents
  WHERE user_id = NEW.user_id;

  IF cur_count >= limit_val THEN
    RAISE EXCEPTION 'Limite do plano atingido: máximo de % agente(s) no seu plano atual.', limit_val
      USING ERRCODE = 'check_violation',
            HINT = 'Atualize para o plano Pro para aumentar o limite de agentes.';
  END IF;

  RETURN NEW;
END;
$function$;