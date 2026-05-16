-- ============================================================
-- AG IA Esportes — Migration 015
-- Marcação de origem em lineups (Fase E.0A.4): permitir distinguir
-- lineup vinda do API-Football vs escalação prevista manual.
--
--   football_lineups          : + source, + raw_source
--   football_lineup_players   : + source
--
-- Pré-requisitos: 001..014 aplicadas.
-- Aditiva — colunas com DEFAULT, sem mexer em rows existentes.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- 1) football_lineups
-- ============================================================
ALTER TABLE football_lineups
  ADD COLUMN IF NOT EXISTS source     TEXT DEFAULT 'api',
  ADD COLUMN IF NOT EXISTS raw_source TEXT;

-- CHECK em source (idempotente)
ALTER TABLE football_lineups DROP CONSTRAINT IF EXISTS chk_lineups_source;
ALTER TABLE football_lineups
  ADD CONSTRAINT chk_lineups_source
  CHECK (source IN ('api','manual_predicted','manual_confirmed','external'));

CREATE INDEX IF NOT EXISTS idx_football_lineups_source
  ON football_lineups (source);


-- ============================================================
-- 2) football_lineup_players
-- ============================================================
ALTER TABLE football_lineup_players
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'api';

ALTER TABLE football_lineup_players DROP CONSTRAINT IF EXISTS chk_lineup_players_source;
ALTER TABLE football_lineup_players
  ADD CONSTRAINT chk_lineup_players_source
  CHECK (source IN ('api','manual_predicted','manual_confirmed','external'));

CREATE INDEX IF NOT EXISTS idx_football_lineup_players_source
  ON football_lineup_players (source);
