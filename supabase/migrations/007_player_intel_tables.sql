-- ============================================================
-- AG IA Esportes — Migration 007
-- Player Intelligence + Matchup Engine
--
-- Estende football_player_profiles (criada na 003) com novos
-- campos exigidos pela Fase 4 e cria 3 tabelas novas:
--
--   football_player_recent_form
--   football_player_matchups
--   football_player_action_probabilities
--
-- Pré-requisitos: 001..006 aplicadas.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- 1) ALTER football_player_profiles  (criada na 003)
--    Adiciona campos exigidos pela Fase 4. Nada removido.
-- ============================================================
ALTER TABLE football_player_profiles
  ADD COLUMN IF NOT EXISTS api_player_id        INTEGER,
  ADD COLUMN IF NOT EXISTS player_name          TEXT,
  ADD COLUMN IF NOT EXISTS primary_position     TEXT,
  ADD COLUMN IF NOT EXISTS secondary_positions  TEXT[],
  ADD COLUMN IF NOT EXISTS archetype            TEXT,
  ADD COLUMN IF NOT EXISTS traits_json          JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at           TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_player_profiles_api_id
  ON football_player_profiles (api_player_id);
CREATE INDEX IF NOT EXISTS idx_player_profiles_archetype
  ON football_player_profiles (archetype);


-- ============================================================
-- 2) football_player_recent_form
--    Médias por ação dos últimos N jogos do jogador.
-- ============================================================
CREATE TABLE IF NOT EXISTS football_player_recent_form (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id              UUID NOT NULL REFERENCES football_players(id) ON DELETE CASCADE,
  api_player_id          INTEGER NOT NULL,
  team_id                UUID REFERENCES football_teams(id),
  sample_size            INTEGER NOT NULL DEFAULT 0,
  minutes_avg            NUMERIC DEFAULT 0,
  shots_avg              NUMERIC DEFAULT 0,
  shots_on_avg           NUMERIC DEFAULT 0,
  fouls_committed_avg    NUMERIC DEFAULT 0,
  fouls_drawn_avg        NUMERIC DEFAULT 0,
  tackles_avg            NUMERIC DEFAULT 0,
  interceptions_avg      NUMERIC DEFAULT 0,
  cards_avg              NUMERIC DEFAULT 0,
  key_passes_avg         NUMERIC DEFAULT 0,
  crosses_avg            NUMERIC DEFAULT 0,
  duels_won_avg          NUMERIC DEFAULT 0,
  duels_lost_avg         NUMERIC DEFAULT 0,
  calculated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (player_id)
);

CREATE INDEX IF NOT EXISTS idx_player_recent_form_api_id
  ON football_player_recent_form (api_player_id);
CREATE INDEX IF NOT EXISTS idx_player_recent_form_team
  ON football_player_recent_form (team_id);


-- ============================================================
-- 3) football_player_matchups
--    Confrontos diretos jogador × jogador para um fixture.
-- ============================================================
CREATE TABLE IF NOT EXISTS football_player_matchups (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id          UUID NOT NULL REFERENCES football_fixtures(id) ON DELETE CASCADE,
  api_fixture_id      INTEGER NOT NULL,
  player_id           UUID REFERENCES football_players(id),
  opponent_player_id  UUID REFERENCES football_players(id),
  matchup_zone        TEXT,             -- ex.: 'right-flank', 'central-midfield'
  player_archetype    TEXT,
  opponent_archetype  TEXT,
  advantage_score     NUMERIC DEFAULT 0,  -- -1..+1, do ponto de vista de player
  risk_score          NUMERIC DEFAULT 0,  -- ex.: prob. de cartão/foul
  explanation_json    JSONB DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (fixture_id, player_id, opponent_player_id)
);

CREATE INDEX IF NOT EXISTS idx_player_matchups_fixture
  ON football_player_matchups (fixture_id);
CREATE INDEX IF NOT EXISTS idx_player_matchups_player
  ON football_player_matchups (player_id);
CREATE INDEX IF NOT EXISTS idx_player_matchups_opponent
  ON football_player_matchups (opponent_player_id);
CREATE INDEX IF NOT EXISTS idx_player_matchups_zone
  ON football_player_matchups (matchup_zone);


-- ============================================================
-- 4) football_player_action_probabilities
--    Probabilidade de uma ação individual em um fixture.
-- ============================================================
CREATE TABLE IF NOT EXISTS football_player_action_probabilities (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id          UUID NOT NULL REFERENCES football_fixtures(id) ON DELETE CASCADE,
  api_fixture_id      INTEGER NOT NULL,
  player_id           UUID REFERENCES football_players(id),
  api_player_id       INTEGER,
  player_name         TEXT,
  team_id             UUID REFERENCES football_teams(id),
  opponent_team_id    UUID REFERENCES football_teams(id),
  action_key          TEXT NOT NULL,
  action_label        TEXT NOT NULL,
  line                NUMERIC NOT NULL DEFAULT 0.5,
  probability         NUMERIC NOT NULL,
  fair_odd            NUMERIC,
  confidence_score    NUMERIC DEFAULT 0,
  data_quality_score  NUMERIC DEFAULT 0,
  matchup_score       NUMERIC DEFAULT 0,
  model_version       TEXT DEFAULT 'player-intel-v0.1',
  explanation_json    JSONB DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- UNIQUE com api_player_id null (raro): aceita NULL como diferente.
CREATE UNIQUE INDEX IF NOT EXISTS uq_player_action_probs_key
  ON football_player_action_probabilities (
    fixture_id,
    COALESCE(api_player_id, 0),
    action_key,
    line,
    model_version
  );

CREATE INDEX IF NOT EXISTS idx_player_action_probs_fixture
  ON football_player_action_probabilities (fixture_id);
CREATE INDEX IF NOT EXISTS idx_player_action_probs_player
  ON football_player_action_probabilities (player_id);
CREATE INDEX IF NOT EXISTS idx_player_action_probs_api_player
  ON football_player_action_probabilities (api_player_id);
CREATE INDEX IF NOT EXISTS idx_player_action_probs_action
  ON football_player_action_probabilities (action_key);
CREATE INDEX IF NOT EXISTS idx_player_action_probs_team
  ON football_player_action_probabilities (team_id);
CREATE INDEX IF NOT EXISTS idx_player_action_probs_confidence
  ON football_player_action_probabilities (confidence_score);


-- ============================================================
-- RLS
--   Tabelas internas — leitura para authenticated.
--   Escrita: service_role (bypass RLS por padrão).
-- ============================================================
ALTER TABLE football_player_recent_form           ENABLE ROW LEVEL SECURITY;
ALTER TABLE football_player_matchups              ENABLE ROW LEVEL SECURITY;
ALTER TABLE football_player_action_probabilities  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pintel_read_recent_form"
  ON football_player_recent_form
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "pintel_read_matchups"
  ON football_player_matchups
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "pintel_read_action_probs"
  ON football_player_action_probabilities
  FOR SELECT TO authenticated USING (true);
