-- Remove temporarily the plan limit triggers

-- Drop trigger for sources limit
DROP TRIGGER IF EXISTS check_sources_limit ON public.sources;

-- Drop trigger for agents limit  
DROP TRIGGER IF EXISTS check_agents_limit ON public.agents;

-- Drop trigger for monthly questions limit
DROP TRIGGER IF EXISTS check_monthly_questions_limit ON public.qa_sessions;

-- Comment: The limit enforcement functions will remain in the database but won't be triggered.
-- To re-enable limits later, recreate the triggers with:
-- CREATE TRIGGER check_sources_limit BEFORE INSERT ON public.sources FOR EACH ROW EXECUTE FUNCTION enforce_sources_limit();
-- CREATE TRIGGER check_agents_limit BEFORE INSERT ON public.agents FOR EACH ROW EXECUTE FUNCTION enforce_agents_limit();
-- CREATE TRIGGER check_monthly_questions_limit BEFORE INSERT ON public.qa_sessions FOR EACH ROW EXECUTE FUNCTION enforce_monthly_questions_limit();