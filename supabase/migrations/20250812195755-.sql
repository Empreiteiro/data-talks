-- Check current constraint and fix it
-- First, let's see what the current constraint allows and remove it
ALTER TABLE public.sources DROP CONSTRAINT IF EXISTS sources_type_check;

-- Create a new constraint that allows the file types we're using
ALTER TABLE public.sources ADD CONSTRAINT sources_type_check 
CHECK (type IN ('csv', 'xlsx', 'xls', 'excel', 'file', 'bigquery', 'database'));