-- Add instructions field to agents table
ALTER TABLE agents ADD COLUMN IF NOT EXISTS instructions TEXT;