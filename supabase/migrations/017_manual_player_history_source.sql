-- ============================================================
-- AG IA Esportes — Migration 017
-- Marcação de origem em histórico individual de jogador (Fase E.0A.6).
--
-- Quando o plano free do API-Football bloqueia /fixtures?team=&last=,
-- precisamos importar manualmente o histórico last5 por jogador a
-- partir de fonte externa (boletim do clube, planilha, etc.).
--
--   football_player_match_stats : + source, + raw_source, + confidence_score
--
-- Pré-requisitos: 001..016 aplicadas.
-- Aditiva — colunas com DEFAULT, sem mexer em rows existentes.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- 1) football_player_match_stats
-- ============================================================
ALTER TABLE football_player_match_stats
  ADD COLUMN IF NOT EXISTS source            TEXT DEFAULT 'api',
  ADD COLUMN IF NOT EXISTS raw_source        TEXT,
  ADD COLUMN IF NOT EXISTS confidence_score  NUMERIC DEFAULT 1;

ALTER TABLE football_player_match_stats DROP CONSTRAINT IF EXISTS chk_player_stats_source;
ALTER TABLE football_player_match_stats
  ADD CONSTRAINT chk_player_stats_source
  CHECK (
    source IN ('api','manual_history','imported_csv','external')
  );

CREATE INDEX IF NOT EXISTS idx_player_stats_source
  ON football_player_match_stats (source);
