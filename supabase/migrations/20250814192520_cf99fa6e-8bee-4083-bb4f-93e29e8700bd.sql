-- Add policy to allow reading shared QA sessions
CREATE POLICY "Allow reading shared QA sessions"
ON public.qa_sessions
FOR SELECT
USING (is_shared = true);