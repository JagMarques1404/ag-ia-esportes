-- ============================================================
-- AG IA Esportes — Migration 014
-- Catálogo local de ligas e times (Fase E.0A.1).
--
-- Motivação: filtrar fixtures por (api_league_id, country) em vez de
-- league_name puro. Sem isso "Premier League" pega Inglaterra + Kuwait
-- + Bahrein + Bielorrússia, todos com o mesmo nome.
--
--   football_leagues_catalog  : 1 linha por liga global (api_league_id unique)
--   football_teams_catalog    : 1 linha por time global (api_team_id unique)
--   football_league_teams     : ponte N:N por temporada
--
-- Pré-requisitos: 001..013 aplicadas.
-- Aditiva: nenhum schema existente é alterado.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- 1) football_leagues_catalog
-- ============================================================
CREATE TABLE IF NOT EXISTS football_leagues_catalog (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_league_id  BIGINT UNIQUE NOT NULL,
  name           TEXT NOT NULL,
  type           TEXT,                 -- 'League' | 'Cup'
  country        TEXT,                 -- 'England', 'Brazil', 'World', ...
  country_code   TEXT,                 -- 'GB', 'BR', null para World
  logo_url       TEXT,
  flag_url       TEXT,
  seasons        JSONB DEFAULT '[]'::jsonb,
  is_priority    BOOLEAN DEFAULT FALSE,
  is_auto_pick   BOOLEAN DEFAULT FALSE,
  coverage_level TEXT DEFAULT 'unknown',
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leagues_catalog_country
  ON football_leagues_catalog (country);
CREATE INDEX IF NOT EXISTS idx_leagues_catalog_auto_pick
  ON football_leagues_catalog (is_auto_pick) WHERE is_auto_pick = TRUE;
CREATE INDEX IF NOT EXISTS idx_leagues_catalog_priority
  ON football_leagues_catalog (is_priority) WHERE is_priority = TRUE;


-- ============================================================
-- 2) football_teams_catalog
-- ============================================================
CREATE TABLE IF NOT EXISTS football_teams_catalog (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_team_id  BIGINT UNIQUE NOT NULL,
  name         TEXT NOT NULL,
  code         TEXT,
  country      TEXT,
  founded      INT,
  national     BOOLEAN DEFAULT FALSE,
  logo_url     TEXT,
  raw_json     JSONB DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teams_catalog_country
  ON football_teams_catalog (country);


-- ============================================================
-- 3) football_league_teams (ponte por temporada)
-- ============================================================
CREATE TABLE IF NOT EXISTS football_league_teams (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_league_id  BIGINT NOT NULL,
  api_team_id    BIGINT NOT NULL,
  season         INT NOT NULL,
  country        TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (api_league_id, api_team_id, season)
);

CREATE INDEX IF NOT EXISTS idx_league_teams_league_season
  ON football_league_teams (api_league_id, season);
CREATE INDEX IF NOT EXISTS idx_league_teams_team_season
  ON football_league_teams (api_team_id, season);


-- ============================================================
-- Triggers updated_at — reusa função do 001
-- ============================================================
DROP TRIGGER IF EXISTS trg_leagues_catalog_updated ON football_leagues_catalog;
CREATE TRIGGER trg_leagues_catalog_updated
  BEFORE UPDATE ON football_leagues_catalog
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_teams_catalog_updated ON football_teams_catalog;
CREATE TRIGGER trg_teams_catalog_updated
  BEFORE UPDATE ON football_teams_catalog
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- RLS — catálogo é leitura pública (authenticated select),
-- escrita só via service_role (script).
-- ============================================================
ALTER TABLE football_leagues_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE football_teams_catalog   ENABLE ROW LEVEL SECURITY;
ALTER TABLE football_league_teams    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leagues_catalog_read_authenticated"
  ON football_leagues_catalog;
CREATE POLICY "leagues_catalog_read_authenticated"
  ON football_leagues_catalog
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "teams_catalog_read_authenticated"
  ON football_teams_catalog;
CREATE POLICY "teams_catalog_read_authenticated"
  ON football_teams_catalog
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "league_teams_read_authenticated"
  ON football_league_teams;
CREATE POLICY "league_teams_read_authenticated"
  ON football_league_teams
  FOR SELECT TO authenticated USING (true);
