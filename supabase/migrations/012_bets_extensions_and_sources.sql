-- ============================================================
-- AG IA Esportes — Migration 012
-- Extensões aditivas para registro de apostas via IA / texto / print.
--
--   bets         : + source_type, source_text, source_image_url,
--                  + match_name, + pick_id (FK public_picks).
--   bet_legs     : + player_name, + line (numeric), + actual_value,
--                  + notes.
--   bankroll_log : enum.type ganha 'bet_void'.
--
-- Pré-requisitos: 001..011 aplicadas.
-- Esta migration só ADICIONA colunas/checks. Nada removido.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- 1) bets — colunas de origem da aposta + match_name + pick_id
-- ============================================================
ALTER TABLE bets
  ADD COLUMN IF NOT EXISTS source_type      TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_text      TEXT,
  ADD COLUMN IF NOT EXISTS source_image_url TEXT,
  ADD COLUMN IF NOT EXISTS match_name       TEXT,
  ADD COLUMN IF NOT EXISTS pick_id          UUID;

-- FK opcional para public_picks (sem ON DELETE CASCADE — manter histórico
-- da aposta mesmo se a pick for removida).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_bets_pick_id'
      AND table_name = 'bets'
  ) THEN
    ALTER TABLE bets
      ADD CONSTRAINT fk_bets_pick_id
      FOREIGN KEY (pick_id) REFERENCES public_picks(id) ON DELETE SET NULL;
  END IF;
END$$;

-- CHECK em source_type (idempotente)
ALTER TABLE bets DROP CONSTRAINT IF EXISTS chk_bets_source_type;
ALTER TABLE bets
  ADD CONSTRAINT chk_bets_source_type
  CHECK (
    source_type IS NULL OR
    source_type IN ('manual','text','image','ai','pick')
  );


-- ============================================================
-- 2) bet_legs — campos para suportar "Watkins 2+ chutes" etc.
-- ============================================================
ALTER TABLE bet_legs
  ADD COLUMN IF NOT EXISTS player_name  TEXT,
  ADD COLUMN IF NOT EXISTS line         NUMERIC,
  ADD COLUMN IF NOT EXISTS actual_value TEXT,
  ADD COLUMN IF NOT EXISTS notes        TEXT;


-- ============================================================
-- 3) bankroll_log — adicionar 'bet_void' ao enum (devolve stake)
--
-- Postgres não tem ALTER CHECK direto; faz drop+add do constraint.
-- ============================================================
ALTER TABLE bankroll_log DROP CONSTRAINT IF EXISTS bankroll_log_type_check;
ALTER TABLE bankroll_log
  ADD CONSTRAINT bankroll_log_type_check
  CHECK (type IN (
    'deposit',
    'withdraw',
    'bet_placed',
    'bet_loss',
    'bet_win',
    'bet_void',
    'cashout',
    'adjustment'
  ));


-- ============================================================
-- Índices úteis
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_bets_user_source
  ON bets (user_id, source_type);
CREATE INDEX IF NOT EXISTS idx_bets_pick_id
  ON bets (pick_id);
