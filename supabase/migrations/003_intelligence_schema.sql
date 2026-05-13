-- ============================================================
-- AG IA Esportes — Migration 003
-- Fase 1: Intelligence Schema
--   Esqueleto do "cérebro" no banco. Sem chamadas externas,
--   sem geração de conteúdo — apenas as tabelas, índices,
--   policies, triggers e views que o motor autônomo vai usar.
--
-- Pré-requisitos: 001_init.sql, 002_fixes_and_summary_trigger.sql.
-- Rode este SQL no SQL Editor do Supabase, na ordem.
-- ============================================================

-- gen_random_uuid() vem do pgcrypto (built-in no Postgres 13+)
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- 1) football_leagues
--    Competições suportadas (importadas do provider de dados)
-- ============================================================
CREATE TABLE IF NOT EXISTS football_leagues (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_league_id INTEGER UNIQUE,
  name         TEXT NOT NULL,
  country      TEXT,
  type         TEXT,
  logo         TEXT,
  season       INTEGER,
  priority     INTEGER DEFAULT 100,
  active       BOOLEAN DEFAULT TRUE,
  raw_json     JSONB,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_football_leagues_active ON football_leagues(active);
CREATE INDEX IF NOT EXISTS idx_football_leagues_priority ON football_leagues(priority);


-- ============================================================
-- 2) football_teams
-- ============================================================
CREATE TABLE IF NOT EXISTS football_teams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_team_id INTEGER UNIQUE,
  name        TEXT NOT NULL,
  country     TEXT,
  logo        TEXT,
  venue_name  TEXT,
  raw_json    JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_football_teams_name ON football_teams(name);


-- ============================================================
-- 3) football_players
-- ============================================================
CREATE TABLE IF NOT EXISTS football_players (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_player_id      INTEGER UNIQUE,
  name               TEXT NOT NULL,
  firstname          TEXT,
  lastname           TEXT,
  age                INTEGER,
  birth_date         DATE,
  nationality        TEXT,
  height             TEXT,
  weight             TEXT,
  photo              TEXT,
  preferred_position TEXT,
  dominant_foot      TEXT,
  current_team_id    UUID REFERENCES football_teams(id),
  raw_json           JSONB,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_football_players_team ON football_players(current_team_id);
CREATE INDEX IF NOT EXISTS idx_football_players_name ON football_players(name);


-- ============================================================
-- 4) football_fixtures
-- ============================================================
CREATE TABLE IF NOT EXISTS football_fixtures (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_fixture_id    INTEGER UNIQUE,
  date              DATE NOT NULL,
  kickoff_at        TIMESTAMPTZ,
  timezone          TEXT,
  league_id         UUID REFERENCES football_leagues(id),
  api_league_id     INTEGER,
  league_name       TEXT,
  season            INTEGER,
  round             TEXT,
  home_team_id      UUID REFERENCES football_teams(id),
  away_team_id      UUID REFERENCES football_teams(id),
  api_home_team_id  INTEGER,
  api_away_team_id  INTEGER,
  home_team_name    TEXT,
  away_team_name    TEXT,
  status            TEXT,
  elapsed           INTEGER,
  goals_home        INTEGER,
  goals_away        INTEGER,
  venue_name        TEXT,
  referee           TEXT,
  importance_score  NUMERIC DEFAULT 0,
  raw_json          JSONB,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_football_fixtures_date ON football_fixtures(date);
CREATE INDEX IF NOT EXISTS idx_football_fixtures_status ON football_fixtures(status);
CREATE INDEX IF NOT EXISTS idx_football_fixtures_league ON football_fixtures(league_id);
CREATE INDEX IF NOT EXISTS idx_football_fixtures_home_team ON football_fixtures(home_team_id);
CREATE INDEX IF NOT EXISTS idx_football_fixtures_away_team ON football_fixtures(away_team_id);
CREATE INDEX IF NOT EXISTS idx_football_fixtures_date_status ON football_fixtures(date, status);


-- ============================================================
-- 5) football_lineups
-- ============================================================
CREATE TABLE IF NOT EXISTS football_lineups (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id   UUID REFERENCES football_fixtures(id) ON DELETE CASCADE,
  team_id      UUID REFERENCES football_teams(id),
  api_team_id  INTEGER,
  formation    TEXT,
  coach_name   TEXT,
  is_confirmed BOOLEAN DEFAULT FALSE,
  raw_json     JSONB,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_football_lineups_fixture ON football_lineups(fixture_id);
CREATE INDEX IF NOT EXISTS idx_football_lineups_team ON football_lineups(team_id);


-- ============================================================
-- 6) football_lineup_players
-- ============================================================
CREATE TABLE IF NOT EXISTS football_lineup_players (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lineup_id     UUID REFERENCES football_lineups(id) ON DELETE CASCADE,
  fixture_id    UUID REFERENCES football_fixtures(id) ON DELETE CASCADE,
  team_id       UUID REFERENCES football_teams(id),
  player_id     UUID REFERENCES football_players(id),
  api_player_id INTEGER,
  player_name   TEXT,
  position      TEXT,
  grid          TEXT,
  number        INTEGER,
  is_starting   BOOLEAN DEFAULT TRUE,
  raw_json      JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_football_lineup_players_lineup ON football_lineup_players(lineup_id);
CREATE INDEX IF NOT EXISTS idx_football_lineup_players_fixture ON football_lineup_players(fixture_id);
CREATE INDEX IF NOT EXISTS idx_football_lineup_players_team ON football_lineup_players(team_id);
CREATE INDEX IF NOT EXISTS idx_football_lineup_players_player ON football_lineup_players(player_id);


-- ============================================================
-- 7) football_team_match_stats
-- ============================================================
CREATE TABLE IF NOT EXISTS football_team_match_stats (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id        UUID REFERENCES football_fixtures(id) ON DELETE CASCADE,
  team_id           UUID REFERENCES football_teams(id),
  opponent_team_id  UUID REFERENCES football_teams(id),
  shots_total       INTEGER DEFAULT 0,
  shots_on          INTEGER DEFAULT 0,
  shots_off         INTEGER DEFAULT 0,
  blocked_shots     INTEGER DEFAULT 0,
  corners           INTEGER DEFAULT 0,
  fouls             INTEGER DEFAULT 0,
  yellow_cards      INTEGER DEFAULT 0,
  red_cards         INTEGER DEFAULT 0,
  possession        NUMERIC,
  passes            INTEGER,
  passes_accurate   INTEGER,
  attacks           INTEGER,
  dangerous_attacks INTEGER,
  raw_json          JSONB,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_football_team_match_stats_fixture ON football_team_match_stats(fixture_id);
CREATE INDEX IF NOT EXISTS idx_football_team_match_stats_team ON football_team_match_stats(team_id);


-- ============================================================
-- 8) football_player_match_stats
-- ============================================================
CREATE TABLE IF NOT EXISTS football_player_match_stats (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id         UUID REFERENCES football_fixtures(id) ON DELETE CASCADE,
  team_id            UUID REFERENCES football_teams(id),
  opponent_team_id   UUID REFERENCES football_teams(id),
  player_id          UUID REFERENCES football_players(id),
  api_player_id      INTEGER,
  player_name        TEXT,
  position           TEXT,
  minutes            INTEGER DEFAULT 0,
  rating             NUMERIC,
  shots_total        INTEGER DEFAULT 0,
  shots_on           INTEGER DEFAULT 0,
  goals              INTEGER DEFAULT 0,
  assists            INTEGER DEFAULT 0,
  passes_total       INTEGER DEFAULT 0,
  passes_key         INTEGER DEFAULT 0,
  tackles_total      INTEGER DEFAULT 0,
  interceptions      INTEGER DEFAULT 0,
  duels_total        INTEGER DEFAULT 0,
  duels_won          INTEGER DEFAULT 0,
  dribbles_attempts  INTEGER DEFAULT 0,
  dribbles_success   INTEGER DEFAULT 0,
  fouls_drawn        INTEGER DEFAULT 0,
  fouls_committed    INTEGER DEFAULT 0,
  yellow_cards       INTEGER DEFAULT 0,
  red_cards          INTEGER DEFAULT 0,
  raw_json           JSONB,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_football_player_match_stats_fixture ON football_player_match_stats(fixture_id);
CREATE INDEX IF NOT EXISTS idx_football_player_match_stats_player ON football_player_match_stats(player_id);
CREATE INDEX IF NOT EXISTS idx_football_player_match_stats_team ON football_player_match_stats(team_id);
CREATE INDEX IF NOT EXISTS idx_football_player_match_stats_fixture_player ON football_player_match_stats(fixture_id, player_id);


-- ============================================================
-- 9) football_player_profiles
--    Perfil agregado/derivado por jogador (role, estilo, etc.)
-- ============================================================
CREATE TABLE IF NOT EXISTS football_player_profiles (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id             UUID REFERENCES football_players(id) ON DELETE CASCADE,
  role_label            TEXT,
  play_style            TEXT,
  strengths_json        JSONB DEFAULT '[]'::jsonb,
  weaknesses_json       JSONB DEFAULT '[]'::jsonb,
  action_profile_json   JSONB DEFAULT '{}'::jsonb,
  matchup_profile_json  JSONB DEFAULT '{}'::jsonb,
  reliability_score     NUMERIC DEFAULT 0,
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_football_player_profiles_player ON football_player_profiles(player_id);


-- ============================================================
-- 10) football_action_probabilities
--     Probabilidades por ação/mercado calculadas pelo motor
-- ============================================================
CREATE TABLE IF NOT EXISTS football_action_probabilities (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id          UUID REFERENCES football_fixtures(id) ON DELETE CASCADE,
  player_id           UUID REFERENCES football_players(id),
  team_id             UUID REFERENCES football_teams(id),
  player_name         TEXT,
  market_type         TEXT NOT NULL,
  line                NUMERIC NOT NULL,
  probability         NUMERIC NOT NULL,
  confidence          TEXT DEFAULT 'medium',
  sample_size         INTEGER DEFAULT 0,
  last_5_hit_rate     NUMERIC,
  last_10_hit_rate    NUMERIC,
  season_hit_rate     NUMERIC,
  fair_odds           NUMERIC,
  risk_level          TEXT DEFAULT 'medium',
  reasoning           TEXT,
  data_quality        TEXT DEFAULT 'unknown',
  raw_features_json   JSONB DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_football_action_probs_fixture ON football_action_probabilities(fixture_id);
CREATE INDEX IF NOT EXISTS idx_football_action_probs_player ON football_action_probabilities(player_id);
CREATE INDEX IF NOT EXISTS idx_football_action_probs_team ON football_action_probabilities(team_id);
CREATE INDEX IF NOT EXISTS idx_football_action_probs_market ON football_action_probabilities(market_type);
CREATE INDEX IF NOT EXISTS idx_football_action_probs_fixture_market ON football_action_probabilities(fixture_id, market_type);


-- ============================================================
-- 11) football_matchup_reports
--     Confrontos diretos (jogador x jogador / time x time)
-- ============================================================
CREATE TABLE IF NOT EXISTS football_matchup_reports (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id          UUID REFERENCES football_fixtures(id) ON DELETE CASCADE,
  player_id           UUID REFERENCES football_players(id),
  opponent_player_id  UUID REFERENCES football_players(id),
  team_id             UUID REFERENCES football_teams(id),
  opponent_team_id    UUID REFERENCES football_teams(id),
  matchup_type        TEXT,
  market_type         TEXT,
  probability_delta   NUMERIC DEFAULT 0,
  analysis_json       JSONB DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_football_matchups_fixture ON football_matchup_reports(fixture_id);
CREATE INDEX IF NOT EXISTS idx_football_matchups_player ON football_matchup_reports(player_id);
CREATE INDEX IF NOT EXISTS idx_football_matchups_team ON football_matchup_reports(team_id);


-- ============================================================
-- 12) football_betting_recommendations
--     Recomendações geradas pela IA (Odd Certa do Dia + tiers)
-- ============================================================
CREATE TABLE IF NOT EXISTS football_betting_recommendations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id            UUID REFERENCES football_fixtures(id) ON DELETE CASCADE,
  title                 TEXT NOT NULL,
  tier                  TEXT NOT NULL,
  selections_json       JSONB NOT NULL DEFAULT '[]'::jsonb,
  combined_probability  NUMERIC,
  fair_odds             NUMERIC,
  market_odds           NUMERIC,
  value_score           NUMERIC,
  stake_suggestion      NUMERIC,
  reasoning             TEXT,
  risk_alerts_json      JSONB DEFAULT '[]'::jsonb,
  status                TEXT DEFAULT 'generated',
  result                TEXT,
  hit                   BOOLEAN,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_football_recs_fixture ON football_betting_recommendations(fixture_id);
CREATE INDEX IF NOT EXISTS idx_football_recs_tier ON football_betting_recommendations(tier);
CREATE INDEX IF NOT EXISTS idx_football_recs_status ON football_betting_recommendations(status);
CREATE INDEX IF NOT EXISTS idx_football_recs_hit ON football_betting_recommendations(hit);


-- ============================================================
-- 13) football_post_match_reviews
--     Aprendizado pós-jogo (predicted vs. observed)
-- ============================================================
CREATE TABLE IF NOT EXISTS football_post_match_reviews (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id  UUID REFERENCES football_betting_recommendations(id) ON DELETE CASCADE,
  fixture_id         UUID REFERENCES football_fixtures(id) ON DELETE CASCADE,
  result             TEXT,
  hit                BOOLEAN,
  error_type         TEXT,
  review_json        JSONB DEFAULT '{}'::jsonb,
  learning_notes     TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_football_reviews_rec ON football_post_match_reviews(recommendation_id);
CREATE INDEX IF NOT EXISTS idx_football_reviews_fixture ON football_post_match_reviews(fixture_id);


-- ============================================================
-- 14) football_sync_runs
--     Telemetria/auditoria de jobs de ingestão
-- ============================================================
CREATE TABLE IF NOT EXISTS football_sync_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        TEXT NOT NULL,
  sync_type       TEXT NOT NULL,
  status          TEXT DEFAULT 'running',
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  requests_used   INTEGER DEFAULT 0,
  records_created INTEGER DEFAULT 0,
  records_updated INTEGER DEFAULT 0,
  error_message   TEXT,
  metadata_json   JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_football_sync_runs_status ON football_sync_runs(status);
CREATE INDEX IF NOT EXISTS idx_football_sync_runs_provider_type ON football_sync_runs(provider, sync_type);
CREATE INDEX IF NOT EXISTS idx_football_sync_runs_started ON football_sync_runs(started_at DESC);


-- ============================================================
-- RLS (Row Level Security)
-- TODO Fase 2+: endurecer escrita para SERVICE_ROLE / admin.
-- Hoje: leitura e escrita para qualquer usuário autenticado.
-- Esses dados são "globais" (não user-scoped), então RLS aqui
-- protege contra anônimos e não contra um usuário malicioso.
-- ============================================================
ALTER TABLE football_leagues                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE football_teams                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE football_players                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE football_fixtures                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE football_lineups                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE football_lineup_players           ENABLE ROW LEVEL SECURITY;
ALTER TABLE football_team_match_stats         ENABLE ROW LEVEL SECURITY;
ALTER TABLE football_player_match_stats       ENABLE ROW LEVEL SECURITY;
ALTER TABLE football_player_profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE football_action_probabilities     ENABLE ROW LEVEL SECURITY;
ALTER TABLE football_matchup_reports          ENABLE ROW LEVEL SECURITY;
ALTER TABLE football_betting_recommendations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE football_post_match_reviews       ENABLE ROW LEVEL SECURITY;
ALTER TABLE football_sync_runs                ENABLE ROW LEVEL SECURITY;

-- Policies de leitura (authenticated)
CREATE POLICY "intel_read_leagues"      ON football_leagues                 FOR SELECT TO authenticated USING (true);
CREATE POLICY "intel_read_teams"        ON football_teams                   FOR SELECT TO authenticated USING (true);
CREATE POLICY "intel_read_players"      ON football_players                 FOR SELECT TO authenticated USING (true);
CREATE POLICY "intel_read_fixtures"     ON football_fixtures                FOR SELECT TO authenticated USING (true);
CREATE POLICY "intel_read_lineups"      ON football_lineups                 FOR SELECT TO authenticated USING (true);
CREATE POLICY "intel_read_lineup_pl"    ON football_lineup_players          FOR SELECT TO authenticated USING (true);
CREATE POLICY "intel_read_team_stats"   ON football_team_match_stats        FOR SELECT TO authenticated USING (true);
CREATE POLICY "intel_read_player_stats" ON football_player_match_stats      FOR SELECT TO authenticated USING (true);
CREATE POLICY "intel_read_profiles"     ON football_player_profiles         FOR SELECT TO authenticated USING (true);
CREATE POLICY "intel_read_probs"        ON football_action_probabilities    FOR SELECT TO authenticated USING (true);
CREATE POLICY "intel_read_matchups"     ON football_matchup_reports         FOR SELECT TO authenticated USING (true);
CREATE POLICY "intel_read_recs"         ON football_betting_recommendations FOR SELECT TO authenticated USING (true);
CREATE POLICY "intel_read_reviews"      ON football_post_match_reviews      FOR SELECT TO authenticated USING (true);
CREATE POLICY "intel_read_sync_runs"    ON football_sync_runs               FOR SELECT TO authenticated USING (true);

-- Policies de escrita (authenticated)
-- TODO Fase 2+: restringir para SERVICE_ROLE em ingestões automáticas.
CREATE POLICY "intel_write_leagues"      ON football_leagues                 FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "intel_update_leagues"     ON football_leagues                 FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "intel_write_teams"        ON football_teams                   FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "intel_update_teams"       ON football_teams                   FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "intel_write_players"      ON football_players                 FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "intel_update_players"     ON football_players                 FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "intel_write_fixtures"     ON football_fixtures                FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "intel_update_fixtures"    ON football_fixtures                FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "intel_write_lineups"      ON football_lineups                 FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "intel_update_lineups"     ON football_lineups                 FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "intel_write_lineup_pl"    ON football_lineup_players          FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "intel_write_team_stats"   ON football_team_match_stats        FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "intel_update_team_stats"  ON football_team_match_stats        FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "intel_write_player_stats" ON football_player_match_stats      FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "intel_update_player_stats" ON football_player_match_stats     FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "intel_write_profiles"     ON football_player_profiles         FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "intel_update_profiles"    ON football_player_profiles         FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "intel_write_probs"        ON football_action_probabilities    FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "intel_update_probs"       ON football_action_probabilities    FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "intel_write_matchups"     ON football_matchup_reports         FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "intel_update_matchups"    ON football_matchup_reports         FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "intel_write_recs"         ON football_betting_recommendations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "intel_update_recs"        ON football_betting_recommendations FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "intel_write_reviews"      ON football_post_match_reviews      FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "intel_write_sync_runs"    ON football_sync_runs               FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "intel_update_sync_runs"   ON football_sync_runs               FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


-- ============================================================
-- Triggers update_updated_at — reaproveita função do 001_init
-- ============================================================
CREATE TRIGGER trg_leagues_updated     BEFORE UPDATE ON football_leagues                 FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_teams_updated       BEFORE UPDATE ON football_teams                   FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_players_updated     BEFORE UPDATE ON football_players                 FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_fixtures_updated    BEFORE UPDATE ON football_fixtures                FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_lineups_updated     BEFORE UPDATE ON football_lineups                 FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_team_stats_updated  BEFORE UPDATE ON football_team_match_stats        FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_player_stats_updated BEFORE UPDATE ON football_player_match_stats     FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_profiles_updated    BEFORE UPDATE ON football_player_profiles         FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_probs_updated       BEFORE UPDATE ON football_action_probabilities    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_matchups_updated    BEFORE UPDATE ON football_matchup_reports         FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_recs_updated        BEFORE UPDATE ON football_betting_recommendations FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- VIEWS
-- ============================================================

-- vw_football_fixtures_today
--   Jogos do dia corrente, ordenados por importância e kickoff.
CREATE OR REPLACE VIEW vw_football_fixtures_today AS
SELECT
  f.id,
  f.api_fixture_id,
  f.date,
  f.kickoff_at,
  f.league_id,
  f.league_name,
  f.season,
  f.round,
  f.home_team_id,
  f.away_team_id,
  f.home_team_name,
  f.away_team_name,
  f.status,
  f.goals_home,
  f.goals_away,
  f.venue_name,
  f.referee,
  f.importance_score
FROM football_fixtures f
WHERE f.date = CURRENT_DATE
ORDER BY f.importance_score DESC NULLS LAST, f.kickoff_at ASC NULLS LAST;


-- vw_top_action_probabilities
--   Top probabilidades por fixture, agrupadas por mercado.
CREATE OR REPLACE VIEW vw_top_action_probabilities AS
SELECT
  p.id,
  p.fixture_id,
  f.date            AS fixture_date,
  f.league_name,
  f.home_team_name,
  f.away_team_name,
  p.player_id,
  p.player_name,
  p.team_id,
  p.market_type,
  p.line,
  p.probability,
  p.confidence,
  p.risk_level,
  p.data_quality,
  p.last_5_hit_rate,
  p.last_10_hit_rate,
  p.season_hit_rate,
  p.fair_odds,
  p.sample_size,
  p.updated_at
FROM football_action_probabilities p
JOIN football_fixtures f ON f.id = p.fixture_id
WHERE p.probability IS NOT NULL
ORDER BY p.probability DESC, p.confidence DESC;


-- vw_odd_certa_do_dia
--   "Odd certa do dia": melhor recomendação por fixture do dia,
--   priorizando tier 'segura' e maior value_score.
CREATE OR REPLACE VIEW vw_odd_certa_do_dia AS
WITH ranked AS (
  SELECT
    r.*,
    f.date AS fixture_date,
    f.league_name,
    f.home_team_name,
    f.away_team_name,
    f.kickoff_at,
    ROW_NUMBER() OVER (
      PARTITION BY r.fixture_id
      ORDER BY
        CASE r.tier
          WHEN 'segura'        THEN 1
          WHEN 'intermediaria' THEN 2
          WHEN 'avancada'      THEN 3
          WHEN 'mega'          THEN 4
          ELSE 5
        END,
        COALESCE(r.value_score, 0) DESC,
        COALESCE(r.combined_probability, 0) DESC
    ) AS rk
  FROM football_betting_recommendations r
  JOIN football_fixtures f ON f.id = r.fixture_id
  WHERE f.date = CURRENT_DATE
    AND r.status = 'generated'
)
SELECT *
FROM ranked
WHERE rk = 1;


-- vw_recommendation_performance
--   Performance histórica das recomendações por tier e mercado.
CREATE OR REPLACE VIEW vw_recommendation_performance AS
SELECT
  r.tier,
  COUNT(*)                                                AS total,
  COUNT(*) FILTER (WHERE r.hit IS TRUE)                   AS wins,
  COUNT(*) FILTER (WHERE r.hit IS FALSE)                  AS losses,
  COUNT(*) FILTER (WHERE r.hit IS NULL)                   AS pending,
  CASE
    WHEN COUNT(*) FILTER (WHERE r.hit IS NOT NULL) > 0
    THEN ROUND(
      (COUNT(*) FILTER (WHERE r.hit IS TRUE)::numeric
        / NULLIF(COUNT(*) FILTER (WHERE r.hit IS NOT NULL), 0)) * 100,
      2
    )
    ELSE 0
  END                                                     AS hit_rate_pct,
  ROUND(AVG(r.value_score)::numeric, 4)                   AS avg_value_score,
  ROUND(AVG(r.combined_probability)::numeric, 4)          AS avg_combined_prob
FROM football_betting_recommendations r
GROUP BY r.tier;
