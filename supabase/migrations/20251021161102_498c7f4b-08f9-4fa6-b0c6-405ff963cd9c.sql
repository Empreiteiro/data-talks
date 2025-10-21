-- Remove referência a is_shared do trigger enforce_monthly_questions_limit
DROP TRIGGER IF EXISTS enforce_monthly_questions_limit_trigger ON public.qa_sessions;

CREATE OR REPLACE FUNCTION public.enforce_monthly_questions_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  is_subscribed boolean := false;
  tier text := NULL;
  limit_val integer;
  cur_count integer;
  start_month timestamp with time zone := date_trunc('month', now());
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
    limit_val := 1000;
  ELSE
    limit_val := 50;
  END IF;

  SELECT COUNT(*) INTO cur_count
  FROM public.qa_sessions
  WHERE user_id = NEW.user_id
    AND created_at >= start_month;

  IF cur_count >= limit_val THEN
    RAISE EXCEPTION 'Limite mensal de perguntas atingido: máximo de % perguntas/mês no seu plano atual.', limit_val
      USING ERRCODE = 'check_violation',
            HINT = 'Atualize para o plano Pro para aumentar o limite mensal.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_monthly_questions_limit_trigger
  BEFORE INSERT ON public.qa_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_monthly_questions_limit();