-- Add conversation_history column to store all interactions in a session
ALTER TABLE public.qa_sessions 
ADD COLUMN conversation_history JSONB DEFAULT '[]'::jsonb;

-- Create index for better performance on conversation_history queries
CREATE INDEX idx_qa_sessions_conversation_history ON public.qa_sessions USING GIN(conversation_history);