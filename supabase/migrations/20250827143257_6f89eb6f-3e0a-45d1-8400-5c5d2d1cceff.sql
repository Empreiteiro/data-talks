
-- 1) TRAVA DE LIMITE PARA FONTES (sources)
DROP TRIGGER IF EXISTS trg_enforce_sources_limit ON public.sources;
DROP FUNCTION IF EXISTS public.enforce_sources_limit();

CREATE FUNCTION public.enforce_sources_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
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

  -- Limites: Trial (default) vs Pro
  IF is_subscribed = true AND tier = 'Pro' THEN
    limit_val := 5; -- Pro: 5 fontes
  ELSE
    limit_val := 2; -- Trial: 2 fontes
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
$$;

CREATE TRIGGER trg_enforce_sources_limit
BEFORE INSERT ON public.sources
FOR EACH ROW
EXECUTE FUNCTION public.enforce_sources_limit();


-- 2) TRAVA DE LIMITE PARA AGENTES (agents)
DROP TRIGGER IF EXISTS trg_enforce_agents_limit ON public.agents;
DROP FUNCTION IF EXISTS public.enforce_agents_limit();

CREATE FUNCTION public.enforce_agents_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
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
    limit_val := 10; -- Pro: 10 agentes
  ELSE
    limit_val := 2; -- Trial: 2 agentes
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
$$;

CREATE TRIGGER trg_enforce_agents_limit
BEFORE INSERT ON public.agents
FOR EACH ROW
EXECUTE FUNCTION public.enforce_agents_limit();


-- 3) TRAVA DE LIMITE MENSAL PARA PERGUNTAS (qa_sessions)
DROP TRIGGER IF EXISTS trg_enforce_monthly_questions_limit ON public.qa_sessions;
DROP FUNCTION IF EXISTS public.enforce_monthly_questions_limit();

CREATE FUNCTION public.enforce_monthly_questions_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  is_subscribed boolean := false;
  tier text := NULL;
  limit_val integer;
  cur_count integer;
  start_month timestamp with time zone := date_trunc('month', now());
BEGIN
  -- Não contar perguntas compartilhadas
  IF COALESCE(NEW.is_shared, false) = true THEN
    RETURN NEW;
  END IF;

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
    limit_val := 1000; -- Pro: 1000 perguntas/mês
  ELSE
    limit_val := 20; -- Trial: 20 perguntas/mês
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

CREATE TRIGGER trg_enforce_monthly_questions_limit
BEFORE INSERT ON public.qa_sessions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_monthly_questions_limit();
