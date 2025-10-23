-- Adicionar coluna source_id à tabela qa_sessions para rastrear qual fonte foi usada
ALTER TABLE public.qa_sessions 
ADD COLUMN source_id uuid REFERENCES public.sources(id) ON DELETE SET NULL;