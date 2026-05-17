/**
 * Coleta segura de player stats históricos.
 *
 *   npm run collect:player-history -- --dryRun=true --limit=5
 *   npm run collect:player-history -- --limit=3 --daysBack=2
 *   npm run collect:player-history -- --date=2026-05-13 --limit=2
 *
 * Comportamento:
 *  - Lista fixtures FT na janela --daysBack (default 2) que ainda não
 *    têm football_player_match_stats.
 *  - Prioriza ligas em PRIORITY_LEAGUE_NAMES.
 *  - Antes de cada chamada real à API, verifica quota.
 *    Se remaining ≤ 20, aborta sem gastar.
 *  - Se um fixture retornar erro de plano (free plan / date access),
 *    para imediatamente.
 *  - dryRun=true: só lista candidatos, sem chamar API.
 */
process.env.AG_IA_SCRIPT_MODE = "true";

import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), ".env.local"), override: true });

interface CliArgs {
  limit: number;
  date: string | undefined;
  daysBack: number;
  dryRun: boolean;
  allowUnknownLeagues: boolean;
  excludeLowCoverage: boolean;
}

// QUOTA_FLOOR vem de env (API_FOOTBALL_QUOTA_FLOOR, default Pro = 500).
let QUOTA_FLOOR = 500;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseArgs(): CliArgs {
  const argMap = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([a-zA-Z][a-zA-Z0-9-]*)(?:=(.+))?$/);
    if (m) argMap.set(m[1], m[2] ?? "true");
  }
  const limit = Number.parseInt(argMap.get("limit") ?? "5", 10);
  if (!Number.isFinite(limit) || limit <= 0 || limit > 30) {
    throw new Error(`--limit inválido: ${argMap.get("limit")}. Use 1..30.`);
  }
  const daysBack = Number.parseInt(argMap.get("daysBack") ?? "2", 10);
  if (!Number.isFinite(daysBack) || daysBack < 0 || daysBack > 14) {
    throw new Error(`--daysBack inválido: ${argMap.get("daysBack")}. Use 0..14.`);
  }
  const date = argMap.get("date");
  if (date && !DATE_RE.test(date)) {
    throw new Error(`--date inválido: ${date}. Use YYYY-MM-DD.`);
  }
  const dryRun = argMap.get("dryRun") === "true";
  // Defaults conservadores: só ligas comprovadas e blacklist ativa.
  const allowUnknownLeagues = argMap.get("allowUnknownLeagues") === "true";
  const excludeLowCoverage =
    argMap.get("excludeLowCoverage") === undefined
      ? true
      : argMap.get("excludeLowCoverage") !== "false";
  return { limit, date, daysBack, dryRun, allowUnknownLeagues, excludeLowCoverage };
}

function isPlanLimitError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('"plan"') ||
    m.includes("free plan") ||
    m.includes("do not have access to this date")
  );
}

interface PerFixtureResult {
  api_fixture_id: number;
  league_name: string | null;
  status: "ok" | "low-coverage" | "skipped-quota" | "stopped-plan-limit" | "error";
  player_stats?: number;
  error?: string;
}

async function main() {
  const args = parseArgs();
  console.log(
    `→ collect-player-history limit=${args.limit} date=${args.date ?? "—"} daysBack=${args.daysBack} dryRun=${args.dryRun} allowUnknownLeagues=${args.allowUnknownLeagues} excludeLowCoverage=${args.excludeLowCoverage}\n`
  );

  const {
    getFinishedFixturesMissingPlayerStats,
    PRIORITY_LEAGUE_NAMES,
    LOW_COVERAGE_LEAGUE_NAMES,
  } = await import("../lib/player-intel/history-candidates");
  const { getQuotaSummary } = await import("../lib/api-football/quota");
  const { getApiQuotaFloor, getApiPlanName } = await import(
    "../lib/api-football/config"
  );
  QUOTA_FLOOR = getApiQuotaFloor();
  console.log(`→ plano=${getApiPlanName()} quota_floor=${QUOTA_FLOOR}`);
  const { syncFixturePlayerStats } = await import(
    "../lib/api-football/sync"
  );

  const conservative = !args.allowUnknownLeagues;
  console.log(
    `→ ligas aceitas: ${
      conservative
        ? `[PRIORITY] ${PRIORITY_LEAGUE_NAMES.join(", ")}`
        : `qualquer liga (allowUnknownLeagues=true)`
    }`
  );
  if (args.excludeLowCoverage) {
    console.log(
      `→ ligas excluídas (low-coverage): ${LOW_COVERAGE_LEAGUE_NAMES.join(", ")}`
    );
  }
  console.log(
    `→ modo: ${conservative ? "CONSERVADOR (default)" : "ABERTO"}\n`
  );

  const before = await getQuotaSummary();
  console.log(
    `→ Quota antes: ${before.realRequests}/${before.limit} reais, ${before.cachedRequests} cacheadas, ${before.remaining} restantes`
  );

  if (!args.dryRun && before.remaining <= QUOTA_FLOOR) {
    console.error(
      `\n✗ Aborto: quota baixa demais (remaining=${before.remaining} ≤ ${QUOTA_FLOOR}).`
    );
    process.exit(2);
  }

  const candidates = await getFinishedFixturesMissingPlayerStats({
    limit: args.limit,
    date: args.date,
    daysBack: args.daysBack,
    allowUnknownLeagues: args.allowUnknownLeagues,
    excludeLowCoverage: args.excludeLowCoverage,
  });

  console.log(`\n→ Candidatos elegíveis (${candidates.length}):`);
  for (const c of candidates) {
    console.log(
      `   ${c.api_fixture_id}  ${c.kickoff_at ?? "?"}  ${c.league_name ?? "?"} :: ${c.home_team_name ?? "?"} × ${c.away_team_name ?? "?"}`
    );
  }
  if (candidates.length === 0) {
    console.log("\n(nenhum candidato — talvez tudo já tenha stats ou esteja fora da janela)");
  }

  if (args.dryRun) {
    console.log(
      `\n[dryRun] custo estimado se rodar real: ${candidates.length} requests reais.`
    );
    process.exit(0);
  }

  // Execução real, com guarda dupla por fixture.
  const results: PerFixtureResult[] = [];
  let okCount = 0;
  let errCount = 0;
  let stoppedByPlan = false;

  for (const c of candidates) {
    const q = await getQuotaSummary();
    if (q.remaining <= QUOTA_FLOOR) {
      console.warn(
        `\n⚠ Quota cruzou o floor (${q.remaining} ≤ ${QUOTA_FLOOR}). Parando.`
      );
      results.push({
        api_fixture_id: c.api_fixture_id,
        league_name: c.league_name,
        status: "skipped-quota",
      });
      break;
    }

    try {
      const r = await syncFixturePlayerStats(c.api_fixture_id);
      const status: PerFixtureResult["status"] =
        r.total_player_stats > 0 ? "ok" : "low-coverage";
      results.push({
        api_fixture_id: c.api_fixture_id,
        league_name: c.league_name,
        status,
        player_stats: r.total_player_stats,
      });
      if (status === "ok") okCount++;
      const dupNote =
        r.duplicate_players_dropped > 0 || r.duplicate_stats_dropped > 0
          ? `  duplicates removidos: ${r.duplicate_players_dropped} players / ${r.duplicate_stats_dropped} stats`
          : "";
      const invalidNote =
        r.invalid_players_skipped > 0
          ? `  invalid api_id pulados: ${r.invalid_players_skipped}`
          : "";
      console.log(
        `  ${c.api_fixture_id}  ✓ ${r.total_player_stats} player_stats  (${c.league_name ?? "?"})${dupNote}${invalidNote}`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isPlanLimitError(message)) {
        console.log(
          `\n⛔ ${c.api_fixture_id}: plano grátis bloqueia. Parando para preservar quota.`
        );
        results.push({
          api_fixture_id: c.api_fixture_id,
          league_name: c.league_name,
          status: "stopped-plan-limit",
          error: message,
        });
        stoppedByPlan = true;
        break;
      }
      results.push({
        api_fixture_id: c.api_fixture_id,
        league_name: c.league_name,
        status: "error",
        error: message,
      });
      errCount++;
      console.warn(
        `  ${c.api_fixture_id}  ✗ ERRO: ${message.slice(0, 120)}`
      );
    }
  }

  const after = await getQuotaSummary();
  const lowCoverage = results.filter((r) => r.status === "low-coverage").length;

  console.log("\n=========================================");
  console.log(`Fixtures com stats salvos:  ${okCount}`);
  console.log(`Fixtures sem cobertura:     ${lowCoverage}`);
  console.log(`Fixtures com erro:          ${errCount}`);
  if (stoppedByPlan) console.log(`Parado pelo plano:          sim`);
  console.log(
    `Quota antes:                ${before.realRequests}/${before.limit} (${before.remaining} restantes)`
  );
  console.log(
    `Quota depois:               ${after.realRequests}/${after.limit} (${after.remaining} restantes)`
  );
  console.log(
    `Reais consumidas:           ${after.realRequests - before.realRequests}`
  );
  console.log("=========================================");

  process.exit(errCount > 0 && okCount === 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\n✗ Erro fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
