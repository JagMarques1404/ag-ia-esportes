-- ============================================================
-- AG IA Esportes — Migration 011
-- Extensões aditivas para o Player Action Board.
--
--   football_player_match_stats  : + offsides, blocks
--   football_player_action_probabilities :
--       + odd_market, last5_values, sample_size, hit_rate,
--         avg_value, edge, recommendation, data_origin,
--         line_label, action_label, rationale
--
-- Pré-requisitos: 001..010 aplicadas.
-- Esta migration só ADICIONA colunas/índices. Nada removido.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- 1) football_player_match_stats — colunas faltantes
-- ============================================================
ALTER TABLE football_player_match_stats
  ADD COLUMN IF NOT EXISTS offsides INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blocks   INTEGER DEFAULT 0;


-- ============================================================
-- 2) football_player_action_probabilities — board fields
-- ============================================================
ALTER TABLE football_player_action_probabilities
  ADD COLUMN IF NOT EXISTS odd_market    NUMERIC,
  ADD COLUMN IF NOT EXISTS last5_values  JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sample_size   INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hit_rate      NUMERIC,
  ADD COLUMN IF NOT EXISTS avg_value     NUMERIC,
  ADD COLUMN IF NOT EXISTS edge          NUMERIC,
  ADD COLUMN IF NOT EXISTS recommendation TEXT,
  ADD COLUMN IF NOT EXISTS data_origin   TEXT DEFAULT 'db',
  ADD COLUMN IF NOT EXISTS line_label    TEXT,
  -- action_label já existe na tabela (criada na migration 007)
  ADD COLUMN IF NOT EXISTS rationale     TEXT;

-- CHECK constraints (drop+add para idempotência)
ALTER TABLE football_player_action_probabilities
  DROP CONSTRAINT IF EXISTS chk_action_probs_recommendation;
ALTER TABLE football_player_action_probabilities
  ADD CONSTRAINT chk_action_probs_recommendation
  CHECK (recommendation IS NULL OR recommendation IN ('forte','monitorar','evitar'));

ALTER TABLE football_player_action_probabilities
  DROP CONSTRAINT IF EXISTS chk_action_probs_data_origin;
ALTER TABLE football_player_action_probabilities
  ADD CONSTRAINT chk_action_probs_data_origin
  CHECK (data_origin IN ('api','db','manual','contextual','mock','missing'));


-- ============================================================
-- Índices úteis para o board (leitura por fixture / ranking)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_action_probs_recommendation
  ON football_player_action_probabilities (recommendation);
CREATE INDEX IF NOT EXISTS idx_action_probs_data_origin
  ON football_player_action_probabilities (data_origin);
CREATE INDEX IF NOT EXISTS idx_action_probs_probability_desc
  ON football_player_action_probabilities (probability DESC);
CREATE INDEX IF NOT EXISTS idx_action_probs_edge_desc
  ON football_player_action_probabilities (edge DESC NULLS LAST);

-- api_fixture_id e action_key já têm índices das fases anteriores
-- (idx_player_action_probs_api_player, idx_player_action_probs_action).
