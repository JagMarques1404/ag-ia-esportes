import "@/lib/server-only-guard";
import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { assertCanMakeApiRequest } from "./quota";

const PROVIDER = "api-football";

export interface ApiFootballConfig {
  baseUrl: string;
  apiKey: string;
}

export type ApiFootballParams = Record<
  string,
  string | number | boolean | undefined | null
>;

export interface ApiFootballGetOptions {
  /** Permite gastar quota até FREE_PLAN_DAILY_LIMIT em vez de parar no SOFT_LIMIT. */
  essential?: boolean;
  /** Sobrescreve TTL default em segundos. */
  ttlSeconds?: number;
}

export function getApiFootballConfig(): ApiFootballConfig {
  const apiKey = process.env.APISPORTS_KEY;
  const baseUrl =
    process.env.APISPORTS_BASE_URL ?? "https://v3.football.api-sports.io";

  if (!apiKey) {
    throw new Error(
      "APISPORTS_KEY ausente. Configure em .env.local / variáveis da Vercel."
    );
  }
  if (!baseUrl) {
    throw new Error("APISPORTS_BASE_URL ausente.");
  }
  return { apiKey, baseUrl: baseUrl.replace(/\/$/, "") };
}

function canonicalizeParams(params: ApiFootballParams): Record<string, string> {
  const ordered: Record<string, string> = {};
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value === undefined || value === null) continue;
    ordered[key] = String(value);
  }
  return ordered;
}

export function buildQueryString(params: ApiFootballParams): string {
  const ordered = canonicalizeParams(params);
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(ordered)) usp.set(k, v);
  const s = usp.toString();
  return s ? `?${s}` : "";
}

export function createStableParamsHash(params: ApiFootballParams): string {
  const ordered = canonicalizeParams(params);
  const json = JSON.stringify(ordered);
  return createHash("sha256").update(json).digest("hex");
}

/**
 * TTL default em segundos por endpoint.
 * - /fixtures por date: 30 min
 * - /fixtures/lineups: 15 min
 * - /fixtures/statistics: 24h se finalizado, 10 min se ao vivo
 * - default: 1h
 *
 * Heurística "ao vivo": se params contém status='LIVE' ou 'live'=true.
 * Heurística "finalizado": se params contém status='FT'.
 * Quando o caller precisar de TTL diferente, passar `ttlSeconds`.
 */
export function getCacheTTL(
  endpoint: string,
  params: ApiFootballParams
): number {
  const path = endpoint.toLowerCase();
  if (path === "/fixtures" && params.date) return 30 * 60;
  if (path === "/fixtures/lineups") return 15 * 60;
  if (path === "/fixtures/statistics") {
    const status = (params.status ?? "").toString().toUpperCase();
    if (status === "LIVE" || params.live === true) return 10 * 60;
    if (status === "FT") return 24 * 60 * 60;
    return 60 * 60;
  }
  return 60 * 60;
}

interface CachedRow {
  response_json: unknown;
  expires_at: string;
}

async function logRequest(args: {
  endpoint: string;
  params: ApiFootballParams;
  paramsHash: string | null;
  status: "success" | "error";
  statusCode: number | null;
  latencyMs: number | null;
  cached: boolean;
  errorMessage?: string;
}): Promise<void> {
  const supabase = getSupabaseAdmin();
  await supabase.from("api_request_logs").insert({
    provider: PROVIDER,
    endpoint: args.endpoint,
    params_hash: args.paramsHash,
    params_json: args.params,
    status: args.status,
    status_code: args.statusCode,
    latency_ms: args.latencyMs,
    cached: args.cached,
    error_message: args.errorMessage ?? null,
  });
}

export async function apiFootballGet<T = unknown>(
  endpoint: string,
  params: ApiFootballParams = {},
  options: ApiFootballGetOptions = {}
): Promise<T> {
  const config = getApiFootballConfig();
  const paramsHash = createStableParamsHash(params);
  const supabase = getSupabaseAdmin();

  // 1) Tentar cache
  const { data: cached } = await supabase
    .from("api_cache")
    .select("response_json, expires_at")
    .eq("provider", PROVIDER)
    .eq("endpoint", endpoint)
    .eq("params_hash", paramsHash)
    .maybeSingle<CachedRow>();

  if (cached && new Date(cached.expires_at) > new Date()) {
    await logRequest({
      endpoint,
      params,
      paramsHash,
      status: "success",
      statusCode: 200,
      latencyMs: 0,
      cached: true,
    });
    return cached.response_json as T;
  }

  // 2) Verificar quota
  await assertCanMakeApiRequest({ essential: options.essential });

  // 3) Chamar API
  const url = `${config.baseUrl}${endpoint}${buildQueryString(params)}`;
  const startedAt = Date.now();
  let statusCode: number | null = null;

  try {
    const res = await fetch(url, {
      headers: {
        "x-apisports-key": config.apiKey,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    statusCode = res.status;
    const latencyMs = Date.now() - startedAt;

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      const errMessage = `API-Football respondeu sem JSON válido (status ${statusCode})`;
      await logRequest({
        endpoint,
        params,
        paramsHash,
        status: "error",
        statusCode,
        latencyMs,
        cached: false,
        errorMessage: errMessage,
      });
      throw new Error(errMessage);
    }

    if (!res.ok) {
      const errMessage = `API-Football status ${statusCode}: ${JSON.stringify(
        (body as { errors?: unknown })?.errors ?? body
      ).slice(0, 500)}`;
      await logRequest({
        endpoint,
        params,
        paramsHash,
        status: "error",
        statusCode,
        latencyMs,
        cached: false,
        errorMessage: errMessage,
      });
      throw new Error(errMessage);
    }

    // API-Football devolve 200 com `errors` populado em alguns casos
    const apiErrors = (body as { errors?: unknown }).errors;
    const hasApiError =
      apiErrors !== undefined &&
      apiErrors !== null &&
      ((Array.isArray(apiErrors) && apiErrors.length > 0) ||
        (typeof apiErrors === "object" &&
          !Array.isArray(apiErrors) &&
          Object.keys(apiErrors as object).length > 0));

    if (hasApiError) {
      const errMessage = `API-Football errors: ${JSON.stringify(apiErrors).slice(
        0,
        500
      )}`;
      await logRequest({
        endpoint,
        params,
        paramsHash,
        status: "error",
        statusCode,
        latencyMs,
        cached: false,
        errorMessage: errMessage,
      });
      throw new Error(errMessage);
    }

    // 4) Persistir cache + log de sucesso
    const ttlSeconds = options.ttlSeconds ?? getCacheTTL(endpoint, params);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    const { error: cacheError } = await supabase.from("api_cache").upsert(
      {
        provider: PROVIDER,
        endpoint,
        params_hash: paramsHash,
        params_json: params,
        response_json: body,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "provider,endpoint,params_hash" }
    );
    if (cacheError) {
      // Cache é best-effort: não derrubar a requisição
      console.warn(`[api-football] falha ao gravar cache: ${cacheError.message}`);
    }

    await logRequest({
      endpoint,
      params,
      paramsHash,
      status: "success",
      statusCode,
      latencyMs,
      cached: false,
    });

    return body as T;
  } catch (err) {
    if (statusCode === null) {
      // Erro antes de a API responder (network/quota/etc.)
      await logRequest({
        endpoint,
        params,
        paramsHash,
        status: "error",
        statusCode: null,
        latencyMs: Date.now() - startedAt,
        cached: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
    throw err;
  }
}
