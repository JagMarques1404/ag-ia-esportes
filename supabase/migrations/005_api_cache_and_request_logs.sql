-- ============================================================
-- AG IA Esportes — Migration 005
-- Cache HTTP e telemetria de chamadas para a API-Football.
--
-- Pré-requisitos: 001..004 aplicadas.
-- Esta migration cria APENAS o esqueleto de cache/logs.
-- Não há cliente HTTP ainda, nenhuma rota /api/* é introduzida.
-- ============================================================


-- ============================================================
-- 1) api_cache
--    Armazena respostas HTTP serializadas, indexadas por
--    (provider, endpoint, params_hash). Usar params_hash
--    (ex.: SHA-256 do JSON canônico) para evitar chaves longas.
-- ============================================================
CREATE TABLE IF NOT EXISTS api_cache (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      TEXT NOT NULL,
  endpoint      TEXT NOT NULL,
  params_hash   TEXT NOT NULL,
  params_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_json JSONB NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (provider, endpoint, params_hash)
);

CREATE INDEX IF NOT EXISTS idx_api_cache_provider_endpoint
  ON api_cache (provider, endpoint);
CREATE INDEX IF NOT EXISTS idx_api_cache_provider_endpoint_hash
  ON api_cache (provider, endpoint, params_hash);
CREATE INDEX IF NOT EXISTS idx_api_cache_expires_at
  ON api_cache (expires_at);


-- ============================================================
-- 2) api_request_logs
--    Telemetria por chamada. Diferencia hits de cache (cached=true)
--    de requisições "reais" que consomem quota. request_date é
--    column gerada manualmente para particionamento futuro
--    e para ROLLUPs eficientes na view.
-- ============================================================
CREATE TABLE IF NOT EXISTS api_request_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      TEXT NOT NULL,
  endpoint      TEXT NOT NULL,
  params_hash   TEXT,
  params_json   JSONB DEFAULT '{}'::jsonb,
  status        TEXT DEFAULT 'success',
  status_code   INTEGER,
  latency_ms    INTEGER,
  cached        BOOLEAN DEFAULT FALSE,
  request_date  DATE DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_request_logs_provider_date
  ON api_request_logs (provider, request_date);
CREATE INDEX IF NOT EXISTS idx_api_request_logs_endpoint
  ON api_request_logs (endpoint);
CREATE INDEX IF NOT EXISTS idx_api_request_logs_status
  ON api_request_logs (status);
CREATE INDEX IF NOT EXISTS idx_api_request_logs_created_at
  ON api_request_logs (created_at DESC);


-- ============================================================
-- 3) RLS
--    Tabelas internas — em produção só serão escritas pelo
--    server (service_role), que ignora RLS por padrão.
--    Habilitamos RLS e abrimos leitura/escrita a `authenticated`
--    temporariamente para diagnóstico via SQL Editor / app.
--
-- TODO Fase 2+: restringir ALL para service_role e remover
-- as policies de authenticated quando o cliente HTTP estiver
-- pronto. As tabelas não têm dado pessoal, mas params_json
-- pode conter parâmetros sensíveis em algum endpoint.
-- ============================================================
ALTER TABLE api_cache         ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_request_logs  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "api_cache_read_authenticated"
  ON api_cache FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "api_cache_write_authenticated"
  ON api_cache FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "api_cache_update_authenticated"
  ON api_cache FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "api_cache_delete_authenticated"
  ON api_cache FOR DELETE
  TO authenticated USING (true);

CREATE POLICY "api_request_logs_read_authenticated"
  ON api_request_logs FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "api_request_logs_write_authenticated"
  ON api_request_logs FOR INSERT
  TO authenticated WITH CHECK (true);


-- ============================================================
-- 4) Trigger update_updated_at em api_cache
--    Reaproveita a função criada na 001.
-- ============================================================
DROP TRIGGER IF EXISTS trg_api_cache_updated_at ON api_cache;
CREATE TRIGGER trg_api_cache_updated_at
  BEFORE UPDATE ON api_cache
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- 5) View vw_api_usage_today
--    Consumo do dia corrente, separando hits de cache vs.
--    chamadas reais. Mantém request_date na projeção para
--    facilitar JOIN/UNION com views históricas no futuro.
-- ============================================================
CREATE OR REPLACE VIEW vw_api_usage_today AS
SELECT
  provider,
  request_date,
  COUNT(*)                                              AS total_requests,
  COUNT(*) FILTER (WHERE cached IS TRUE)                AS cached_requests,
  COUNT(*) FILTER (WHERE cached IS NOT TRUE)            AS real_requests,
  COUNT(*) FILTER (WHERE status = 'success')            AS success_count,
  COUNT(*) FILTER (WHERE status IS DISTINCT FROM 'success') AS error_count
FROM api_request_logs
WHERE request_date = CURRENT_DATE
GROUP BY provider, request_date;


-- ============================================================
-- 6) View vw_api_cache_status
--    Saúde do cache por (provider, endpoint).
-- ============================================================
CREATE OR REPLACE VIEW vw_api_cache_status AS
SELECT
  provider,
  endpoint,
  COUNT(*)                                  AS total_entries,
  COUNT(*) FILTER (WHERE expires_at <= NOW()) AS expired_entries,
  COUNT(*) FILTER (WHERE expires_at >  NOW()) AS valid_entries,
  MAX(updated_at)                           AS last_cached_at
FROM api_cache
GROUP BY provider, endpoint;
