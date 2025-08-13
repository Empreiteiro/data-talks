-- Add unique constraint to prevent duplicate agent names per user
ALTER TABLE public.agents 
ADD CONSTRAINT agents_user_id_name_unique UNIQUE (user_id, name);