-- Add suggested_questions column to agents table
ALTER TABLE public.agents 
ADD COLUMN suggested_questions TEXT[] DEFAULT '{}';

-- Update the comment for documentation
COMMENT ON COLUMN public.agents.suggested_questions IS 'Array of suggested questions for this agent';