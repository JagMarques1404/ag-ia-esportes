-- ============================================================
-- AG IA Esportes — Migration 018
-- Agenda temporal de análise por fixture (Fase E.0A.9).
--
-- O worker temporal lê esta tabela a cada N min, decide qual fase
-- executar com base em (now - kickoff_at), e atualiza o status.
--
--   fixture_analysis_schedule : 1 linha por (api_fixture_id)
--
-- Pré-requisitos: 001..017 aplicadas.
-- Aditiva — não altera schema existente.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


CREATE TABLE IF NOT EXISTS fixture_analysis_schedule (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_fixture_id              BIGINT UNIQUE NOT NULL,
  fixture_id                  UUID REFERENCES football_fixtures(id) ON DELETE CASCADE,
  match_name                  TEXT,
  league_name                 TEXT,
  kickoff_at                  TIMESTAMPTZ,

  status                      TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN (
      'scheduled',
      'precheck_pending',
      'precheck_done',
      'lineup_pending',
      'lineup_confirmed',
      'lineup_missing',
      'history_collecting',
      'board_ready',
      'picks_draft_ready',
      'blocked',
      'failed'
    )),

  last_precheck_at            TIMESTAMPTZ,
  last_lineup_check_at        TIMESTAMPTZ,
  last_history_collect_at     TIMESTAMPTZ,
  last_board_generated_at     TIMESTAMPTZ,
  last_pick_generated_at      TIMESTAMPTZ,

  lineup_source               TEXT
    CHECK (
      lineup_source IS NULL OR
      lineup_source IN ('none','manual_predicted','api_predicted','api_confirmed','manual_confirmed')
    ),
  readiness_level             TEXT
    CHECK (
      readiness_level IS NULL OR
      readiness_level IN ('READY','WATCHLIST','BLOCKED')
    ),
  readiness_score             NUMERIC DEFAULT 0,
  data_quality_score          NUMERIC DEFAULT 0,
  players_resolved            INT DEFAULT 0,
  players_total               INT DEFAULT 0,
  sample3_count               INT DEFAULT 0,

  error_message               TEXT,
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fas_kickoff
  ON fixture_analysis_schedule (kickoff_at);
CREATE INDEX IF NOT EXISTS idx_fas_status
  ON fixture_analysis_schedule (status);
CREATE INDEX IF NOT EXISTS idx_fas_readiness
  ON fixture_analysis_schedule (readiness_level)
  WHERE readiness_level IS NOT NULL;


-- ============================================================
-- Trigger updated_at — reusa função do 001
-- ============================================================
DROP TRIGGER IF EXISTS trg_fas_updated ON fixture_analysis_schedule;
CREATE TRIGGER trg_fas_updated
  BEFORE UPDATE ON fixture_analysis_schedule
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- RLS — leitura aberta para authenticated, escrita só via service_role
-- ============================================================
ALTER TABLE fixture_analysis_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fas_read_authenticated" ON fixture_analysis_schedule;
CREATE POLICY "fas_read_authenticated"
  ON fixture_analysis_schedule
  FOR SELECT TO authenticated USING (true);
