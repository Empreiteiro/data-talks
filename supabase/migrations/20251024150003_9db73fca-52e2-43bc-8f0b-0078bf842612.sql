-- Add google_sheets to allowed source types
ALTER TABLE sources 
DROP CONSTRAINT sources_type_check;

ALTER TABLE sources 
ADD CONSTRAINT sources_type_check 
CHECK (type = ANY (ARRAY['csv'::text, 'xlsx'::text, 'xls'::text, 'excel'::text, 'file'::text, 'bigquery'::text, 'database'::text, 'google_sheets'::text]));