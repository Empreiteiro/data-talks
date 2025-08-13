-- Add scheduling columns to alerts table
ALTER TABLE public.alerts 
ADD COLUMN execution_time TIME,
ADD COLUMN day_of_week INTEGER, -- 0=Sunday, 1=Monday, etc.
ADD COLUMN day_of_month INTEGER; -- 1-31

-- Add check constraints for valid values
ALTER TABLE public.alerts 
ADD CONSTRAINT valid_day_of_week CHECK (day_of_week IS NULL OR (day_of_week >= 0 AND day_of_week <= 6));

ALTER TABLE public.alerts 
ADD CONSTRAINT valid_day_of_month CHECK (day_of_month IS NULL OR (day_of_month >= 1 AND day_of_month <= 31));