-- Temporarily disable the trigger to debug the soft delete issue
-- This will help us identify if the trigger is causing the RLS violation

-- Disable the trigger temporarily
DROP TRIGGER IF EXISTS check_monthly_question_limit ON public.qa_sessions;

-- We can re-enable it later if needed with:
-- CREATE TRIGGER check_monthly_question_limit
--   BEFORE INSERT ON public.qa_sessions
--   FOR EACH ROW
--   EXECUTE FUNCTION public.check_monthly_question_limit();
