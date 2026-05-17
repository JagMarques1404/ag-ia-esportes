/**
 * Configuração de quota do API-Football lida via env vars.
 *
 * Defaults assumem o plano Pro do API-Football (7500 req/dia).
 * Para downgrade ao free, basta sobrescrever em .env.local:
 *
 *   API_FOOTBALL_PLAN=free
 *   API_FOOTBALL_DAILY_LIMIT=100
 *   API_FOOTBALL_SOFT_LIMIT=90
 *   API_FOOTBALL_QUOTA_FLOOR=20
 *
 * Centralizado aqui para evitar drift entre scripts (vários tinham
 * `const QUOTA_FLOOR = 30` espalhado no código).
 */

function envInt(name: string, fallback: number, min = 1): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min) return fallback;
  return n;
}

function envString(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return raw;
}

/**
 * Nome do plano (informativo, usado em logs).
 * Default: 'pro'
 */
export function getApiPlanName(): string {
  return envString("API_FOOTBALL_PLAN", "pro");
}

/**
 * Limite hard diário do plano. Default Pro = 7500.
 * Antes (free): 100.
 */
export function getApiDailyLimit(): number {
  return envInt("API_FOOTBALL_DAILY_LIMIT", 7500);
}

/**
 * Soft limit (recomendado parar antes desse nível). Default = 95% do daily.
 */
export function getApiSoftLimit(): number {
  const explicit = envInt("API_FOOTBALL_SOFT_LIMIT", 0, 0);
  if (explicit > 0) return explicit;
  return Math.floor(getApiDailyLimit() * 0.95);
}

/**
 * Floor mínimo de reqs restantes para iniciar operação custosa.
 * Default Pro = 500. Antes (free): 30.
 *
 * Scripts devem ler `getApiQuotaFloor()` em vez de hardcodar.
 */
export function getApiQuotaFloor(): number {
  return envInt("API_FOOTBALL_QUOTA_FLOOR", 500);
}

/**
 * Delay entre chamadas consecutivas em ms. Default Pro = 250.
 * Útil para evitar 429 em alta concorrência.
 */
export function getApiRequestDelayMs(): number {
  return envInt("API_FOOTBALL_REQUEST_DELAY_MS", 250, 0);
}
