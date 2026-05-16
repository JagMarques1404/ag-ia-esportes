-- ============================================================
-- AG IA Esportes — Migration 016
-- Resolver de identidade de jogador para escalações manuais
-- (Fase E.0A.5).
--
-- Quando uma escalação prevista entra por seed:manual-lineups, o
-- jogador ganha um api_player_id sintético (range 800M..1B). Esta
-- tabela registra cada tentativa de RESOLVER esse jogador para o
-- api_player_id real do API-Football — primeiro localmente, depois
-- (E.0A.6+) via API.
--
--   player_identity_aliases :
--     - 1 linha por (manual_name, api_team_id, api_player_id_resolvido)
--     - status indica o estado do resolver
--
-- Pré-requisitos: 001..015 aplicadas.
-- Aditiva — não altera schema existente.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- 1) player_identity_aliases
-- ============================================================
CREATE TABLE IF NOT EXISTS player_identity_aliases (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manual_name          TEXT NOT NULL,
  normalized_name      TEXT NOT NULL,
  team_name            TEXT,
  api_team_id          BIGINT,
  api_player_id        BIGINT,
  football_player_id   UUID REFERENCES football_players(id) ON DELETE SET NULL,
  confidence_score     NUMERIC DEFAULT 0,
  sample_size          INT DEFAULT 0,
  source               TEXT DEFAULT 'local_match',
  status               TEXT DEFAULT 'unmatched'
    CHECK (status IN (
      'matched',
      'matched_no_history',
      'ambiguous',
      'unmatched',
      'api_blocked',
      'rejected'
    )),
  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Unique funcional (Postgres não suporta UNIQUE em expressão direta —
-- usa UNIQUE INDEX). Tratamos NULL como 0 para deduplicar.
CREATE UNIQUE INDEX IF NOT EXISTS uq_aliases_norm_team_player
  ON player_identity_aliases (
    normalized_name,
    COALESCE(api_team_id, 0),
    COALESCE(api_player_id, 0)
  );

CREATE INDEX IF NOT EXISTS idx_aliases_normalized
  ON player_identity_aliases (normalized_name);
CREATE INDEX IF NOT EXISTS idx_aliases_status
  ON player_identity_aliases (status);
CREATE INDEX IF NOT EXISTS idx_aliases_api_team
  ON player_identity_aliases (api_team_id) WHERE api_team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_aliases_api_player
  ON player_identity_aliases (api_player_id) WHERE api_player_id IS NOT NULL;


-- ============================================================
-- Trigger updated_at — reusa função do 001
-- ============================================================
DROP TRIGGER IF EXISTS trg_aliases_updated ON player_identity_aliases;
CREATE TRIGGER trg_aliases_updated
  BEFORE UPDATE ON player_identity_aliases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- RLS — read aberto para authenticated, write só via service_role.
-- ============================================================
ALTER TABLE player_identity_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "aliases_read_authenticated"
  ON player_identity_aliases;
CREATE POLICY "aliases_read_authenticated"
  ON player_identity_aliases
  FOR SELECT TO authenticated USING (true);
