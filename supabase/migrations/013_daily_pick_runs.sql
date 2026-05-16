-- ============================================================
-- AG IA Esportes — Migration 013
-- Automação diária base (Fase E.0A): runs do gerador de auto-picks
-- e rascunhos de sugestões sem odds.
--
--   daily_pick_runs        : 1 linha por execução do daily:auto-picks
--   daily_pick_suggestions : N linhas por run (uma por fixture / risk)
--
-- Pré-requisitos: 001..012 aplicadas.
-- Esta migration só ADICIONA tabelas — nenhum schema existente é
-- alterado.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- 1) daily_pick_runs
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_pick_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date            DATE NOT NULL,
  status              TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','running','completed','failed')),
  provider            TEXT,
  fixtures_found      INT DEFAULT 0,
  lineups_synced      INT DEFAULT 0,
  boards_generated    INT DEFAULT 0,
  suggestions_created INT DEFAULT 0,
  picks_created       INT DEFAULT 0,
  warnings            JSONB DEFAULT '[]'::jsonb,
  summary             JSONB DEFAULT '{}'::jsonb,
  started_at          TIMESTAMPTZ DEFAULT NOW(),
  finished_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_pick_runs_date
  ON daily_pick_runs (run_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_pick_runs_status
  ON daily_pick_runs (status, run_date DESC);


-- ============================================================
-- 2) daily_pick_suggestions
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_pick_suggestions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                UUID REFERENCES daily_pick_runs(id) ON DELETE CASCADE,
  run_date              DATE NOT NULL,
  api_fixture_id        BIGINT,
  league_name           TEXT,
  match_name            TEXT,
  risk_level            TEXT NOT NULL
    CHECK (risk_level IN ('safe','value','mega','watchlist')),
  status                TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','skipped')),
  title                 TEXT,
  rationale             TEXT,
  worst_leg             TEXT,
  estimated_probability NUMERIC,
  confidence_score      NUMERIC,
  data_quality_score    NUMERIC,
  suggestions           JSONB DEFAULT '[]'::jsonb,
  public_pick_id        UUID REFERENCES public_picks(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_pick_suggestions_date
  ON daily_pick_suggestions (run_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_pick_suggestions_run
  ON daily_pick_suggestions (run_id);
CREATE INDEX IF NOT EXISTS idx_daily_pick_suggestions_risk_status
  ON daily_pick_suggestions (risk_level, status, run_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_pick_suggestions_fixture
  ON daily_pick_suggestions (api_fixture_id);


-- ============================================================
-- Trigger updated_at — reusa função do 001 (update_updated_at)
-- ============================================================
DROP TRIGGER IF EXISTS trg_daily_pick_suggestions_updated
  ON daily_pick_suggestions;
CREATE TRIGGER trg_daily_pick_suggestions_updated
  BEFORE UPDATE ON daily_pick_suggestions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- RLS
--
-- Os runs e suggestions são compartilhados (não pertencem a 1 usuário).
-- Authenticated pode select/insert/update/delete por enquanto (v0 —
-- enquanto a feature está em construção). Endurecer em fase futura
-- quando houver papel de admin separado.
-- ============================================================
ALTER TABLE daily_pick_runs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_pick_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "daily_runs_authenticated_all"
  ON daily_pick_runs;
CREATE POLICY "daily_runs_authenticated_all"
  ON daily_pick_runs
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "daily_suggestions_authenticated_all"
  ON daily_pick_suggestions;
CREATE POLICY "daily_suggestions_authenticated_all"
  ON daily_pick_suggestions
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
