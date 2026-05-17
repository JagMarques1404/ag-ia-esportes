-- ============================================================
-- AG IA Esportes — Migration 020
-- Lineup Scout externo (Fase E.0A.14).
--
-- Quando a API-Football não retorna lineup para um fixture, o usuário
-- pode colar uma escalação provável/confirmada de fonte externa
-- (FutStats, FotMob, SofaScore, Flashscore, boletim oficial).
--
--   football_external_lineup_sources : 1 linha por (fixture, source).
--
-- Também estende football_lineups com:
--   - source_url
--   - source_confidence
-- (source e is_confirmed já existem das 003/015.)
--
-- Pré-requisitos: 001..019 aplicadas.
-- Aditiva.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- 1) football_external_lineup_sources
-- ============================================================
CREATE TABLE IF NOT EXISTS football_external_lineup_sources (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_fixture_id  BIGINT NOT NULL,
  fixture_id      UUID REFERENCES football_fixtures(id) ON DELETE CASCADE,
  source_name     TEXT NOT NULL,
  source_url      TEXT,
  source_type     TEXT NOT NULL DEFAULT 'predicted'
    CHECK (source_type IN ('predicted','confirmed','manual','squad_preview')),
  raw_text        TEXT,
  parsed_json     JSONB DEFAULT '{}'::jsonb,
  confidence      NUMERIC DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_external_lineup_fixture
  ON football_external_lineup_sources (api_fixture_id);
CREATE INDEX IF NOT EXISTS idx_external_lineup_type
  ON football_external_lineup_sources (source_type);


-- ============================================================
-- 2) football_lineups: + source_url + source_confidence
--    + amplia CHECK de source para incluir external_predicted/confirmed
-- ============================================================
ALTER TABLE football_lineups
  ADD COLUMN IF NOT EXISTS source_url        TEXT,
  ADD COLUMN IF NOT EXISTS source_confidence NUMERIC;

-- Re-define CHECK de source (drop+add) para incluir os novos valores.
ALTER TABLE football_lineups DROP CONSTRAINT IF EXISTS chk_lineups_source;
ALTER TABLE football_lineups
  ADD CONSTRAINT chk_lineups_source
  CHECK (source IN (
    'api',
    'manual_predicted',
    'manual_confirmed',
    'external',
    'external_predicted',
    'external_confirmed',
    'squad_preview'
  ));

-- football_lineup_players: mesma expansão de CHECK
ALTER TABLE football_lineup_players DROP CONSTRAINT IF EXISTS chk_lineup_players_source;
ALTER TABLE football_lineup_players
  ADD CONSTRAINT chk_lineup_players_source
  CHECK (source IN (
    'api',
    'manual_predicted',
    'manual_confirmed',
    'external',
    'external_predicted',
    'external_confirmed',
    'squad_preview'
  ));


-- ============================================================
-- RLS — read aberto para authenticated, write só via service_role
-- ============================================================
ALTER TABLE football_external_lineup_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "external_lineup_read_authenticated"
  ON football_external_lineup_sources;
CREATE POLICY "external_lineup_read_authenticated"
  ON football_external_lineup_sources
  FOR SELECT TO authenticated USING (true);
