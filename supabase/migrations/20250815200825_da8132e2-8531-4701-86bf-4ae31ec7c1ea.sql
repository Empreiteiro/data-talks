-- Add follow_up_questions column to qa_sessions table
ALTER TABLE public.qa_sessions 
ADD COLUMN follow_up_questions JSONB;