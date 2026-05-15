-- ============================================================
-- AG IA Esportes — Migration 008
-- IA Analista Conversacional — chat + ações pendentes
--
--   ai_chat_sessions     conversas do usuário
--   ai_chat_messages     mensagens (user/assistant/system/tool)
--   ai_pending_actions   draft de ações que exigem confirmação
--                        (criar aposta, criar lembrete, etc.)
--
-- Pré-requisitos: 001..007 aplicadas.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- 1) ai_chat_sessions
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_chat_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_user
  ON ai_chat_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_updated
  ON ai_chat_sessions (updated_at DESC);


-- ============================================================
-- 2) ai_chat_messages
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_chat_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content     TEXT NOT NULL,
  metadata    JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_session
  ON ai_chat_messages (session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_user
  ON ai_chat_messages (user_id);


-- ============================================================
-- 3) ai_pending_actions
--    Action_type esperados (v0.1):
--      - create_bet
--      - create_reminder
--    Status: pending → confirmed → executed (ou cancelled / failed).
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_pending_actions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id   UUID REFERENCES ai_chat_sessions(id) ON DELETE SET NULL,
  action_type  TEXT NOT NULL,
  payload      JSONB NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','cancelled','executed','failed')),
  result       JSONB,
  error_message TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  executed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_pending_user_status
  ON ai_pending_actions (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_pending_session
  ON ai_pending_actions (session_id);


-- ============================================================
-- RLS — usuário só acessa o que é dele.
-- service_role (admin client) bypassa RLS automaticamente.
-- ============================================================
ALTER TABLE ai_chat_sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_chat_messages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_pending_actions  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_sessions_owner_all"
  ON ai_chat_sessions
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "ai_messages_owner_all"
  ON ai_chat_messages
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "ai_pending_owner_all"
  ON ai_pending_actions
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ============================================================
-- Triggers update_updated_at — reaproveita função do 001
-- ============================================================
DROP TRIGGER IF EXISTS trg_ai_sessions_updated ON ai_chat_sessions;
CREATE TRIGGER trg_ai_sessions_updated
  BEFORE UPDATE ON ai_chat_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
