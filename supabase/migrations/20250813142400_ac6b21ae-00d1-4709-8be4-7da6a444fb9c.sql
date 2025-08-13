-- Add Langflow integration columns to sources table
ALTER TABLE public.sources 
ADD COLUMN langflow_path text,
ADD COLUMN langflow_name text;