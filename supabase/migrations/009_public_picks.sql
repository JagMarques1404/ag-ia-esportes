-- ============================================================
-- AG IA Esportes — Migration 009
-- public_picks — fonte única das picks publicadas
--
-- Substitui os mocks hardcoded em /picks, /dashboard e
-- analyst-tools.getTodayPicks. Quem cria/edita/marca resultado
-- aciona esta tabela.
--
-- Pré-requisitos: 001..008 aplicadas.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


CREATE TABLE IF NOT EXISTS public_picks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_date       DATE NOT NULL,
  title           TEXT NOT NULL,
  match_name      TEXT NOT NULL,
  league_name     TEXT,
  api_fixture_id  BIGINT,
  kickoff_at      TIMESTAMPTZ,

  risk_level      TEXT NOT NULL CHECK (risk_level IN ('safe','value','mega')),
  status          TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','green','red','void')),

  odd_target      NUMERIC,
  confidence      NUMERIC, -- 0..1
  rationale       TEXT,
  warning         TEXT,

  -- markets: [{ player: string, market: string, odd?: number, line?: number }, ...]
  markets         JSONB NOT NULL DEFAULT '[]'::jsonb,

  result_notes    TEXT,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- Índices
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_public_picks_date_status
  ON public_picks (pick_date DESC, status);
CREATE INDEX IF NOT EXISTS idx_public_picks_status
  ON public_picks (status);
CREATE INDEX IF NOT EXISTS idx_public_picks_api_fixture
  ON public_picks (api_fixture_id);
CREATE INDEX IF NOT EXISTS idx_public_picks_kickoff
  ON public_picks (kickoff_at);
CREATE INDEX IF NOT EXISTS idx_public_picks_risk_level
  ON public_picks (risk_level);


-- ============================================================
-- RLS
--   v0.1: leitura para anônimo + authenticated (vitrine pública).
--   Escrita: authenticated (admin endurecerá em fase futura).
-- TODO: restringir INSERT/UPDATE/DELETE para SERVICE_ROLE ou role
-- 'admin' quando houver controle de papéis.
-- ============================================================
ALTER TABLE public_picks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_picks_read_all"
  ON public_picks
  FOR SELECT
  USING (true);

CREATE POLICY "public_picks_write_authenticated"
  ON public_picks
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "public_picks_update_authenticated"
  ON public_picks
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "public_picks_delete_authenticated"
  ON public_picks
  FOR DELETE
  TO authenticated
  USING (true);


-- ============================================================
-- Trigger update_updated_at — reaproveita função do 001
-- ============================================================
DROP TRIGGER IF EXISTS trg_public_picks_updated ON public_picks;
CREATE TRIGGER trg_public_picks_updated
  BEFORE UPDATE ON public_picks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
