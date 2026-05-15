-- ============================================================
-- AG IA Esportes — Migration 010
-- public_pick_legs — controle de resultado por perna
--
-- Cada pick tem N pernas (mercados). public_picks.markets continua
-- como JSON snapshot de criação; quando uma pick é "settled", as
-- pernas viram linhas reais aqui com status individual.
--
-- Pré-requisitos: 001..009 aplicadas.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


CREATE TABLE IF NOT EXISTS public_pick_legs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_id         UUID NOT NULL REFERENCES public_picks(id) ON DELETE CASCADE,
  position        INT NOT NULL DEFAULT 0,
  player_name     TEXT NOT NULL,
  market          TEXT NOT NULL,
  line            NUMERIC,
  odd             NUMERIC,
  expected_value  TEXT,
  actual_value    TEXT,
  result_status   TEXT NOT NULL DEFAULT 'pending'
    CHECK (result_status IN ('pending','green','red','void')),
  result_notes    TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- Índices
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_public_pick_legs_pick
  ON public_pick_legs (pick_id);
CREATE INDEX IF NOT EXISTS idx_public_pick_legs_status
  ON public_pick_legs (result_status);
CREATE INDEX IF NOT EXISTS idx_public_pick_legs_position
  ON public_pick_legs (pick_id, position);


-- ============================================================
-- RLS
--   Mesma política do public_picks (vitrine pública):
--   leitura aberta, escrita para authenticated.
-- TODO: restringir INSERT/UPDATE/DELETE para SERVICE_ROLE ou role
-- 'admin' quando houver controle de papéis.
-- ============================================================
ALTER TABLE public_pick_legs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_pick_legs_read_all"
  ON public_pick_legs
  FOR SELECT
  USING (true);

CREATE POLICY "public_pick_legs_write_authenticated"
  ON public_pick_legs
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "public_pick_legs_update_authenticated"
  ON public_pick_legs
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "public_pick_legs_delete_authenticated"
  ON public_pick_legs
  FOR DELETE
  TO authenticated
  USING (true);


-- ============================================================
-- Trigger update_updated_at — reaproveita função do 001
-- ============================================================
DROP TRIGGER IF EXISTS trg_public_pick_legs_updated ON public_pick_legs;
CREATE TRIGGER trg_public_pick_legs_updated
  BEFORE UPDATE ON public_pick_legs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
