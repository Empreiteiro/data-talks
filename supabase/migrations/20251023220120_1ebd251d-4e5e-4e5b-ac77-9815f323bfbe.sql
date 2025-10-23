-- Atualizar limite de fontes do plano trial de 5 para 10
CREATE OR REPLACE FUNCTION public.enforce_sources_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
    limit_val := 10;
  ELSE
    limit_val := 10;
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