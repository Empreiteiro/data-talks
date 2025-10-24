-- Update sources table constraint to accept sql_database type
ALTER TABLE sources
DROP CONSTRAINT IF EXISTS sources_type_check;

ALTER TABLE sources
ADD CONSTRAINT sources_type_check
CHECK (type = ANY (ARRAY[
  'csv'::text, 
  'xlsx'::text, 
  'xls'::text, 
  'excel'::text, 
  'file'::text, 
  'bigquery'::text, 
  'database'::text, 
  'google_sheets'::text,
  'sql_database'::text
]));