-- Simplify qa_sessions policies to debug the issue
-- Remove all complex policies and create the most basic ones that should work

-- Drop ALL existing policies for qa_sessions
DROP POLICY IF EXISTS "Users can view their own QA sessions" ON public.qa_sessions;
DROP POLICY IF EXISTS "Users can view QA sessions from their organization" ON public.qa_sessions;
DROP POLICY IF EXISTS "Users can create their own QA sessions" ON public.qa_sessions;
DROP POLICY IF EXISTS "Users and org members can create QA sessions" ON public.qa_sessions;
DROP POLICY IF EXISTS "Users and org members can update QA sessions" ON public.qa_sessions;
DROP POLICY IF EXISTS "Users can soft delete their own QA sessions" ON public.qa_sessions;
DROP POLICY IF EXISTS "Users and org members can update QA sessions content" ON public.qa_sessions;

-- Create the SIMPLEST possible policies that should work
-- SELECT: Users can view their own sessions
CREATE POLICY "Simple: Users can view own sessions"
ON public.qa_sessions
FOR SELECT
USING (auth.uid() = user_id);

-- INSERT: Users can create their own sessions
CREATE POLICY "Simple: Users can create own sessions"
ON public.qa_sessions
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- UPDATE: Users can update their own sessions (including soft delete)
CREATE POLICY "Simple: Users can update own sessions"
ON public.qa_sessions
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- DELETE: Users can delete their own sessions (if needed)
CREATE POLICY "Simple: Users can delete own sessions"
ON public.qa_sessions
FOR DELETE
USING (auth.uid() = user_id);

-- Note: These are the most basic policies possible
-- If these don't work, the problem is elsewhere
