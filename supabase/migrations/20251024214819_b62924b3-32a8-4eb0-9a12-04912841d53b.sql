-- Remove WITH CHECK from Users update policy to allow soft delete
DROP POLICY IF EXISTS "Users can update their own QA sessions" ON public.qa_sessions;

-- Recreate without WITH CHECK - only USING clause to verify ownership before update
CREATE POLICY "Users can update their own QA sessions" 
ON public.qa_sessions 
FOR UPDATE 
USING (auth.uid() = user_id);