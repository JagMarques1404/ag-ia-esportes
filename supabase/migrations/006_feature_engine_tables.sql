-- ============================================================
-- AG IA Esportes — Migration 006
-- Feature Engine + Probability Engine
--
--   football_team_recent_form     forma agregada por time/scope
--   football_fixture_features     features derivadas por fixture
--   football_market_probabilities probabilidades por (fixture, mercado)
--   football_daily_value_board    ranking diário consolidado
--
-- Pré-requisitos: 001..005 aplicadas.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- 1) football_team_recent_form
-- ============================================================
CREATE TABLE IF NOT EXISTS football_team_recent_form (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id                     UUID NOT NULL REFERENCES football_teams(id) ON DELETE CASCADE,
  api_team_id                 INTEGER NOT NULL,
  league_id                   UUID REFERENCES football_leagues(id),
  api_league_id               INTEGER,
  season                      INTEGER,
  scope                       TEXT NOT NULL DEFAULT 'overall',
  sample_size                 INTEGER NOT NULL DEFAULT 0,
  matches_played              INTEGER NOT NULL DEFAULT 0,
  wins                        INTEGER DEFAULT 0,
  draws                       INTEGER DEFAULT 0,
  losses                      INTEGER DEFAULT 0,
  goals_for                   NUMERIC DEFAULT 0,
  goals_against               NUMERIC DEFAULT 0,
  avg_goals_for               NUMERIC DEFAULT 0,
  avg_goals_against           NUMERIC DEFAULT 0,
  clean_sheets                INTEGER DEFAULT 0,
  failed_to_score             INTEGER DEFAULT 0,
  over_05_goals_rate          NUMERIC DEFAULT 0,
  over_15_goals_rate          NUMERIC DEFAULT 0,
  over_25_goals_rate          NUMERIC DEFAULT 0,
  btts_rate                   NUMERIC DEFAULT 0,
  scored_rate                 NUMERIC DEFAULT 0,
  conceded_rate               NUMERIC DEFAULT 0,
  first_half_goal_rate        NUMERIC DEFAULT 0,
  second_half_goal_rate       NUMERIC DEFAULT 0,
  avg_corners_for             NUMERIC,
  avg_corners_against         NUMERIC,
  avg_cards_for               NUMERIC,
  avg_cards_against           NUMERIC,
  avg_shots_on_goal_for       NUMERIC,
  avg_shots_on_goal_against   NUMERIC,
  calculated_at               TIMESTAMPTZ DEFAULT NOW(),
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

-- UNIQUE com colunas potencialmente NULL precisa de COALESCE para
-- garantir conflict detection em UPSERT consistente.
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_recent_form_key
  ON football_team_recent_form (
    team_id,
    COALESCE(league_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(season, 0),
    scope
  );

CREATE INDEX IF NOT EXISTS idx_team_recent_form_team
  ON football_team_recent_form (team_id);
CREATE INDEX IF NOT EXISTS idx_team_recent_form_league
  ON football_team_recent_form (league_id);
CREATE INDEX IF NOT EXISTS idx_team_recent_form_scope
  ON football_team_recent_form (scope);


-- ============================================================
-- 2) football_fixture_features
-- ============================================================
CREATE TABLE IF NOT EXISTS football_fixture_features (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id               UUID NOT NULL REFERENCES football_fixtures(id) ON DELETE CASCADE,
  api_fixture_id           INTEGER NOT NULL,
  home_team_id             UUID NOT NULL,
  away_team_id             UUID NOT NULL,
  league_id                UUID,
  date                     DATE NOT NULL,
  kickoff_at               TIMESTAMPTZ,
  home_form_sample         INTEGER DEFAULT 0,
  away_form_sample         INTEGER DEFAULT 0,
  home_avg_goals_for       NUMERIC DEFAULT 0,
  home_avg_goals_against   NUMERIC DEFAULT 0,
  away_avg_goals_for       NUMERIC DEFAULT 0,
  away_avg_goals_against   NUMERIC DEFAULT 0,
  expected_home_goals      NUMERIC DEFAULT 0,
  expected_away_goals      NUMERIC DEFAULT 0,
  expected_total_goals     NUMERIC DEFAULT 0,
  expected_btts_score      NUMERIC DEFAULT 0,
  pace_score               NUMERIC DEFAULT 0,
  volatility_score         NUMERIC DEFAULT 0,
  data_quality_score       NUMERIC DEFAULT 0,
  confidence_score         NUMERIC DEFAULT 0,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (fixture_id)
);

CREATE INDEX IF NOT EXISTS idx_fixture_features_date
  ON football_fixture_features (date);
CREATE INDEX IF NOT EXISTS idx_fixture_features_api_fx
  ON football_fixture_features (api_fixture_id);
CREATE INDEX IF NOT EXISTS idx_fixture_features_league
  ON football_fixture_features (league_id);


-- ============================================================
-- 3) football_market_probabilities
-- ============================================================
CREATE TABLE IF NOT EXISTS football_market_probabilities (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id           UUID NOT NULL REFERENCES football_fixtures(id) ON DELETE CASCADE,
  api_fixture_id       INTEGER NOT NULL,
  market_key           TEXT NOT NULL,
  market_label         TEXT NOT NULL,
  selection            TEXT NOT NULL,
  probability          NUMERIC NOT NULL,
  fair_odd             NUMERIC,
  confidence_score     NUMERIC DEFAULT 0,
  data_quality_score   NUMERIC DEFAULT 0,
  risk_level           TEXT DEFAULT 'medium',
  model_version        TEXT DEFAULT 'v0.1-baseline',
  explanation_json     JSONB DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (fixture_id, market_key, selection, model_version)
);

CREATE INDEX IF NOT EXISTS idx_market_probs_fixture
  ON football_market_probabilities (fixture_id);
CREATE INDEX IF NOT EXISTS idx_market_probs_api_fx
  ON football_market_probabilities (api_fixture_id);
CREATE INDEX IF NOT EXISTS idx_market_probs_market
  ON football_market_probabilities (market_key);
CREATE INDEX IF NOT EXISTS idx_market_probs_confidence
  ON football_market_probabilities (confidence_score);
CREATE INDEX IF NOT EXISTS idx_market_probs_risk
  ON football_market_probabilities (risk_level);


-- ============================================================
-- 4) football_daily_value_board
-- ============================================================
CREATE TABLE IF NOT EXISTS football_daily_value_board (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date                DATE NOT NULL,
  fixture_id          UUID NOT NULL REFERENCES football_fixtures(id) ON DELETE CASCADE,
  api_fixture_id      INTEGER NOT NULL,
  league_name         TEXT,
  home_team_name      TEXT,
  away_team_name      TEXT,
  market_key          TEXT NOT NULL,
  selection           TEXT NOT NULL,
  probability         NUMERIC NOT NULL,
  fair_odd            NUMERIC,
  confidence_score    NUMERIC DEFAULT 0,
  data_quality_score  NUMERIC DEFAULT 0,
  risk_level          TEXT DEFAULT 'medium',
  rank_score          NUMERIC DEFAULT 0,
  category            TEXT DEFAULT 'watchlist',
  reason              TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (date, fixture_id, market_key, selection)
);

CREATE INDEX IF NOT EXISTS idx_dvb_date
  ON football_daily_value_board (date);
CREATE INDEX IF NOT EXISTS idx_dvb_fixture
  ON football_daily_value_board (fixture_id);
CREATE INDEX IF NOT EXISTS idx_dvb_api_fx
  ON football_daily_value_board (api_fixture_id);
CREATE INDEX IF NOT EXISTS idx_dvb_market
  ON football_daily_value_board (market_key);
CREATE INDEX IF NOT EXISTS idx_dvb_category
  ON football_daily_value_board (category);
CREATE INDEX IF NOT EXISTS idx_dvb_rank
  ON football_daily_value_board (rank_score DESC);


-- ============================================================
-- RLS — derivadas internas
-- Leitura: authenticated. Escrita: service_role (bypass RLS por padrão,
-- não precisa de policy).
-- TODO: revisar quando houver helper de admin user.
-- ============================================================
ALTER TABLE football_team_recent_form     ENABLE ROW LEVEL SECURITY;
ALTER TABLE football_fixture_features     ENABLE ROW LEVEL SECURITY;
ALTER TABLE football_market_probabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE football_daily_value_board    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "feat_read_team_form"   ON football_team_recent_form
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "feat_read_fix_feats"   ON football_fixture_features
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "feat_read_market"      ON football_market_probabilities
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "feat_read_dvb"         ON football_daily_value_board
  FOR SELECT TO authenticated USING (true);


-- ============================================================
-- Triggers update_updated_at — reaproveita função do 001
-- ============================================================
DROP TRIGGER IF EXISTS trg_team_recent_form_updated ON football_team_recent_form;
CREATE TRIGGER trg_team_recent_form_updated
  BEFORE UPDATE ON football_team_recent_form
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_fixture_features_updated ON football_fixture_features;
CREATE TRIGGER trg_fixture_features_updated
  BEFORE UPDATE ON football_fixture_features
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_market_probs_updated ON football_market_probabilities;
CREATE TRIGGER trg_market_probs_updated
  BEFORE UPDATE ON football_market_probabilities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_daily_value_board_updated ON football_daily_value_board;
CREATE TRIGGER trg_daily_value_board_updated
  BEFORE UPDATE ON football_daily_value_board
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
