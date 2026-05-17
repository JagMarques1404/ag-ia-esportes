import "@/lib/server-only-guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  getApiDailyLimit,
  getApiSoftLimit,
  getApiQuotaFloor,
} from "./config";

/**
 * @deprecated Use `getApiDailyLimit()` de @/lib/api-football/config.
 * Mantido para retrocompatibilidade com imports antigos. Lê do env var
 * `API_FOOTBALL_DAILY_LIMIT` (default Pro = 7500).
 */
export const FREE_PLAN_DAILY_LIMIT = getApiDailyLimit();

/**
 * @deprecated Use `getApiSoftLimit()` de @/lib/api-football/config.
 */
export const SOFT_LIMIT = getApiSoftLimit();

/** Re-export para facilitar imports antigos em scripts. */
export const QUOTA_FLOOR = getApiQuotaFloor();

const PROVIDER = "api-football";

export interface ApiUsageSnapshot {
  total: number;
  cached: number;
  real: number;
  errors: number;
}

export interface QuotaCheckOptions {
  /** Se true, ignora o SOFT_LIMIT e bloqueia só em getApiDailyLimit(). */
  essential?: boolean;
}

export interface QuotaSummary {
  used: number;
  remaining: number;
  limit: number;
  softLimit: number;
  realRequests: number;
  cachedRequests: number;
  errors: number;
}

function todayString(): string {
  return new Date().toISOString().split("T")[0];
}

export async function getTodayApiUsage(): Promise<ApiUsageSnapshot> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("api_request_logs")
    .select("cached, status")
    .eq("provider", PROVIDER)
    .eq("request_date", todayString());

  if (error) {
    throw new Error(`Erro ao consultar api_request_logs: ${error.message}`);
  }

  const rows = data ?? [];
  const total = rows.length;
  const cached = rows.filter((r) => r.cached === true).length;
  const real = total - cached;
  const errors = rows.filter((r) => r.status !== "success").length;
  return { total, cached, real, errors };
}

export async function getRemainingApiRequests(): Promise<number> {
  const usage = await getTodayApiUsage();
  return Math.max(0, getApiDailyLimit() - usage.real);
}

export async function canMakeApiRequest(
  options: QuotaCheckOptions = {}
): Promise<boolean> {
  const usage = await getTodayApiUsage();
  if (usage.real >= getApiDailyLimit()) return false;
  if (usage.real >= SOFT_LIMIT && !options.essential) return false;
  return true;
}

export async function assertCanMakeApiRequest(
  options: QuotaCheckOptions = {}
): Promise<void> {
  const allowed = await canMakeApiRequest(options);
  if (!allowed) {
    const usage = await getTodayApiUsage();
    const reason =
      usage.real >= getApiDailyLimit()
        ? `Limite diário (${getApiDailyLimit()}) atingido`
        : `Soft-limit (${SOFT_LIMIT}) atingido — só requisições essenciais`;
    throw new Error(
      `${reason}. Hoje: ${usage.real} reais / ${usage.cached} cacheadas / ${usage.errors} erros.`
    );
  }
}

export async function getQuotaSummary(): Promise<QuotaSummary> {
  const usage = await getTodayApiUsage();
  return {
    used: usage.real,
    remaining: Math.max(0, getApiDailyLimit() - usage.real),
    limit: getApiDailyLimit(),
    softLimit: SOFT_LIMIT,
    realRequests: usage.real,
    cachedRequests: usage.cached,
    errors: usage.errors,
  };
}
