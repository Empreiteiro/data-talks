-- Add is_shared column to qa_sessions table
ALTER TABLE public.qa_sessions 
ADD COLUMN is_shared boolean DEFAULT false;