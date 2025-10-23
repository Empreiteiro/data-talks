-- Adicionar coluna agent_id para vincular fonte ao workspace
ALTER TABLE sources ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id) ON DELETE CASCADE;

-- Adicionar coluna is_active para marcar fonte ativa
ALTER TABLE sources ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT false;

-- Criar índice único parcial: apenas uma fonte ativa por agent
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_source_per_agent 
ON sources (agent_id) 
WHERE is_active = true;

-- Migrar dados existentes: vincular sources ao agent através de source_ids
UPDATE sources s
SET agent_id = a.id
FROM agents a
WHERE s.id = ANY(a.source_ids) AND s.agent_id IS NULL;

-- Ativar a primeira fonte de cada agent (se existir)
WITH first_sources AS (
  SELECT DISTINCT ON (agent_id) id, agent_id
  FROM sources
  WHERE agent_id IS NOT NULL
  ORDER BY agent_id, created_at ASC
)
UPDATE sources
SET is_active = true
WHERE id IN (SELECT id FROM first_sources) AND is_active = false;