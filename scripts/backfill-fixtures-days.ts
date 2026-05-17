/**
 * Backfill de fixtures para os últimos N dias (default 14).
 *
 *   npm run backfill:fixtures -- --days=14
 *   npm run backfill:fixtures -- --days=7 --endDate=2026-05-13
 *
 * Comportamento:
 *  - Itera de endDate para trás, `days` vezes (inclusive endDate).
 *  - Antes de cada chamada, consulta a quota — se restarem ≤ 10
 *    requests reais, para imediatamente.
 *  - Cache válido (TTL 30 min em /fixtures por date) é honrado, então
 *    re-execução do mesmo intervalo não gasta quota nova.
 *  - Falha em uma data não derruba as outras — registra e continua.
 */
process.env.AG_IA_SCRIPT_MODE = "true";

import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), ".env.local"), override: true });

interface CliArgs {
  days: number;
  endDate: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// QUOTA_FLOOR vem de env (API_FOOTBALL_QUOTA_FLOOR, default Pro = 500).
let QUOTA_FLOOR = 500;

function todayString(): string {
  return new Date().toISOString().split("T")[0];
}

function shiftDate(iso: string, deltaDays: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().split("T")[0];
}

function parseArgs(): CliArgs {
  const argMap = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([a-zA-Z][a-zA-Z0-9-]*)(?:=(.+))?$/);
    if (m) argMap.set(m[1], m[2] ?? "true");
  }
  const daysRaw = argMap.get("days") ?? "14";
  const days = Number.parseInt(daysRaw, 10);
  if (!Number.isFinite(days) || days <= 0 || days > 60) {
    throw new Error(
      `--days inválido: ${daysRaw}. Use inteiro entre 1 e 60.`
    );
  }
  const endDate = argMap.get("endDate") ?? todayString();
  if (!DATE_RE.test(endDate)) {
    throw new Error(`--endDate inválido: ${endDate}. Use YYYY-MM-DD.`);
  }
  return { days, endDate };
}

interface PerDateResult {
  date: string;
  status: "ok" | "skipped-quota" | "stopped-plan-limit" | "error";
  total_fixtures?: number;
  total_leagues?: number;
  total_teams?: number;
  error?: string;
}

/**
 * Detecta a mensagem que o provider retorna quando o plano free não
 * permite acesso a uma data anterior. Vista no provider:
 *   {"plan":"Free plans do not have access to this date, try from ..."}
 * O cliente HTTP propaga isso como Error com prefixo "API-Football errors:".
 */
function isPlanLimitError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('"plan"') ||
    m.includes("free plan") ||
    m.includes("do not have access to this date")
  );
}

async function main() {
  const { days, endDate } = parseArgs();
  console.log(`→ Backfill de ${days} dias terminando em ${endDate}\n`);

  const { syncFixturesByDate } = await import("../lib/api-football/sync");
  const { getQuotaSummary } = await import("../lib/api-football/quota");
  const { getApiQuotaFloor, getApiPlanName } = await import(
    "../lib/api-football/config"
  );
  QUOTA_FLOOR = getApiQuotaFloor();
  console.log(`→ plano=${getApiPlanName()} quota_floor=${QUOTA_FLOOR}`);

  const before = await getQuotaSummary();
  console.log(
    `→ Quota antes: ${before.realRequests}/${before.limit} reais, ${before.cachedRequests} cacheadas, ${before.remaining} restantes\n`
  );

  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    dates.push(shiftDate(endDate, -i));
  }

  const results: PerDateResult[] = [];
  let okCount = 0;
  let errCount = 0;
  let skippedCount = 0;
  let stoppedByPlan = false;
  let totalFixtures = 0;

  for (const date of dates) {
    const quota = await getQuotaSummary();
    if (quota.remaining <= QUOTA_FLOOR) {
      console.log(
        `⚠  Quota baixa (${quota.remaining} restantes ≤ ${QUOTA_FLOOR}). Pulando ${date}.`
      );
      results.push({ date, status: "skipped-quota" });
      skippedCount++;
      continue;
    }

    try {
      const r = await syncFixturesByDate(date);
      results.push({
        date,
        status: "ok",
        total_fixtures: r.total_fixtures,
        total_leagues: r.total_leagues,
        total_teams: r.total_teams,
      });
      okCount++;
      totalFixtures += r.total_fixtures;
      console.log(
        `  ${date}  fixtures=${r.total_fixtures.toString().padStart(3)}  ligas=${r.total_leagues.toString().padStart(3)}  times=${r.total_teams.toString().padStart(3)}`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      if (isPlanLimitError(message)) {
        results.push({ date, status: "stopped-plan-limit", error: message });
        stoppedByPlan = true;
        console.log(
          `\n⛔ ${date}: Plano grátis não permite datas anteriores. Backfill interrompido para preservar quota.`
        );
        break;
      }

      results.push({ date, status: "error", error: message });
      errCount++;
      console.warn(`  ${date}  ✗ ERRO: ${message.slice(0, 120)}`);
    }
  }

  const after = await getQuotaSummary();

  console.log("\n=========================================");
  console.log(`Datas processadas:  ${okCount}`);
  console.log(`Datas com erro:     ${errCount}`);
  console.log(`Datas puladas:      ${skippedCount}`);
  if (stoppedByPlan) {
    console.log(`Parado pelo plano:  sim (free plan bloqueia datas antigas)`);
  }
  console.log(`Total fixtures:     ${totalFixtures}`);
  console.log(
    `Quota antes:        ${before.realRequests}/${before.limit} (${before.remaining} restantes)`
  );
  console.log(
    `Quota depois:       ${after.realRequests}/${after.limit} (${after.remaining} restantes)`
  );
  console.log(`Reais consumidas:   ${after.realRequests - before.realRequests}`);
  console.log(`Cache hits:         ${after.cachedRequests - before.cachedRequests}`);
  console.log("=========================================");

  process.exit(errCount > 0 && okCount === 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\n✗ Erro fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
