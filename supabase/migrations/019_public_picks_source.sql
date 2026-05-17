-- ============================================================
-- AG IA Esportes — Migration 019
-- Marcação de origem e estágio em public_picks (Fase E.0A.9).
--
-- Picks geradas pelo worker temporal ganham:
--   - source='board_auto'
--   - generation_stage = 'precheck'|'final'
--   - readiness_snapshot = JSON com sample/dq/players_resolved na hora
--
-- Também expande risk_level para incluir 'solo' e 'watchlist'.
--
-- Pré-requisitos: 001..018 aplicadas.
-- Aditiva — colunas com DEFAULT.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- 1) Novas colunas
-- ============================================================
ALTER TABLE public_picks
  ADD COLUMN IF NOT EXISTS source              TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS generation_stage    TEXT,
  ADD COLUMN IF NOT EXISTS generated_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS readiness_snapshot  JSONB;

ALTER TABLE public_picks DROP CONSTRAINT IF EXISTS chk_public_picks_source;
ALTER TABLE public_picks
  ADD CONSTRAINT chk_public_picks_source
  CHECK (
    source IS NULL OR
    source IN ('manual','board_auto','external','imported')
  );

ALTER TABLE public_picks DROP CONSTRAINT IF EXISTS chk_public_picks_generation_stage;
ALTER TABLE public_picks
  ADD CONSTRAINT chk_public_picks_generation_stage
  CHECK (
    generation_stage IS NULL OR
    generation_stage IN ('precheck','final','manual')
  );

-- Expandir risk_level: incluir 'solo' e 'watchlist'.
ALTER TABLE public_picks DROP CONSTRAINT IF EXISTS public_picks_risk_level_check;
ALTER TABLE public_picks
  ADD CONSTRAINT public_picks_risk_level_check
  CHECK (risk_level IN ('safe','value','mega','solo','watchlist'));


-- ============================================================
-- Índices
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_public_picks_source
  ON public_picks (source);
CREATE INDEX IF NOT EXISTS idx_public_picks_generated_at
  ON public_picks (generated_at DESC) WHERE generated_at IS NOT NULL;
