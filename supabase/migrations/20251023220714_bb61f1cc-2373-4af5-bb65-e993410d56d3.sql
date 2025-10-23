-- Adicionar coluna deleted_at para soft delete
ALTER TABLE public.qa_sessions 
ADD COLUMN deleted_at timestamp with time zone;

-- Criar índice para performance
CREATE INDEX idx_qa_sessions_deleted_at ON public.qa_sessions(deleted_at);

-- Atualizar trigger para contar TODAS as perguntas (incluindo soft-deleted)
CREATE OR REPLACE FUNCTION public.check_monthly_question_limit()
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

  -- CRÍTICO: Contar TODAS as perguntas do mês (incluindo soft-deleted)
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
$function$;

-- Atualizar políticas RLS para ocultar registros deletados
DROP POLICY IF EXISTS "Users can view their own QA sessions" ON public.qa_sessions;

CREATE POLICY "Users can view their own QA sessions"
ON public.qa_sessions
FOR SELECT
USING (
  auth.uid() = user_id 
  AND deleted_at IS NULL
);

DROP POLICY IF EXISTS "Users can view QA sessions from their organization" ON public.qa_sessions;

CREATE POLICY "Users can view QA sessions from their organization"
ON public.qa_sessions
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM agents
    WHERE agents.id = qa_sessions.agent_id
      AND agents.organization_id = user_organization_id(auth.uid())
  )
  AND deleted_at IS NULL
);

-- Remover política de DELETE e garantir UPDATE para soft delete
DROP POLICY IF EXISTS "Users can delete their own QA sessions" ON public.qa_sessions;