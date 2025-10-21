-- Drop the old trigger and function that references non-existent is_shared column
DROP TRIGGER IF EXISTS check_monthly_question_limit ON public.qa_sessions;
DROP FUNCTION IF EXISTS public.check_monthly_question_limit();

-- Recreate the function without is_shared check
CREATE OR REPLACE FUNCTION public.check_monthly_question_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_subscribed boolean := false;
  tier text := NULL;
  limit_val integer;
  cur_count integer;
  start_month timestamp with time zone := date_trunc('month', now());
BEGIN
  -- Skip check if user_id is null
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get user's subscription status
  SELECT COALESCE(s.subscribed, false), s.subscription_tier
  INTO is_subscribed, tier
  FROM public.subscribers s
  WHERE s.user_id = NEW.user_id
  ORDER BY s.updated_at DESC
  LIMIT 1;

  -- Determine limit based on subscription tier
  IF is_subscribed = true AND tier = 'Pro' THEN
    limit_val := 1000;
  ELSE
    limit_val := 50;
  END IF;

  -- Count current month's questions for this user
  SELECT COUNT(*) INTO cur_count
  FROM public.qa_sessions
  WHERE user_id = NEW.user_id
    AND created_at >= start_month;

  -- Check if limit exceeded
  IF cur_count >= limit_val THEN
    RAISE EXCEPTION 'Limite mensal de perguntas atingido: máximo de % perguntas/mês no seu plano atual.', limit_val
      USING ERRCODE = 'check_violation',
            HINT = 'Atualize para o plano Pro para aumentar o limite mensal.';
  END IF;

  RETURN NEW;
END;
$$;

-- Recreate the trigger
CREATE TRIGGER check_monthly_question_limit
  BEFORE INSERT ON public.qa_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.check_monthly_question_limit();