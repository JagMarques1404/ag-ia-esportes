/**
 * Pipeline diário de acumulação de histórico individual.
 *
 *   npm run daily:player-history -- --dryRun=true --limit=5
 *   npm run daily:player-history -- --dryRun=false --limit=3
 *
 * Comportamento:
 *  1. Snapshot de cobertura antes (getPlayerHistoryCoverage).
 *  2. Verifica quota — aborta se remaining ≤ 30.
 *  3. Lista candidatos (getFinishedFixturesMissingPlayerStats).
 *  4. Se --dryRun, só lista e mostra custo estimado.
 *  5. Se não, chama syncFixturePlayerStats em loop respeitando quota
 *     fixture-a-fixture, parando se um erro de plano-limit aparecer.
 *  6. Snapshot depois e diff comparativo.
 *
 * Defensivo por padrão: --dryRun=true é o default. Para coletar de
 * verdade, é preciso passar --dryRun=false explicitamente.
 */
process.env.AG_IA_SCRIPT_MODE = "true";

import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), ".env.local"), override: true });

interface CliArgs {
  limit: number;
  daysBack: number;
  dryRun: boolean;
}

const QUOTA_FLOOR = 30;

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
    throw new Error(
      `--daysBack inválido: ${argMap.get("daysBack")}. Use 0..14.`
    );
  }
  // Default dryRun=true. Só corre coleta com --dryRun=false explícito.
  const dryRunRaw = argMap.get("dryRun");
  const dryRun = dryRunRaw === undefined ? true : dryRunRaw !== "false";
  return { limit, daysBack, dryRun };
}

function isPlanLimitError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('"plan"') ||
    m.includes("free plan") ||
    m.includes("do not have access to this date")
  );
}

function pad(n: number, w = 4): string {
  return String(n).padStart(w);
}

async function main() {
  const args = parseArgs();
  console.log(
    `→ daily:player-history limit=${args.limit} daysBack=${args.daysBack} dryRun=${args.dryRun}\n`
  );

  const { getQuotaSummary } = await import("../lib/api-football/quota");
  const { syncFixturePlayerStats } = await import(
    "../lib/api-football/sync"
  );
  const {
    getFinishedFixturesMissingPlayerStats,
    getPlayerHistoryCoverage,
  } = await import("../lib/player-intel/history-candidates");

  // 1. Snapshot ANTES
  const before = await getPlayerHistoryCoverage();
  const quotaBefore = await getQuotaSummary();

  console.log("=== Cobertura ANTES ===");
  console.log(
    `  players ............ ${pad(before.total_players)}    player_stats ........ ${pad(before.total_player_stats)}`
  );
  console.log(
    `  com 1 jogo ......... ${pad(before.with_one_match)}    com 2 jogos ......... ${pad(before.with_two_matches)}    com 3+ jogos ........ ${pad(before.with_three_or_more)}`
  );
  console.log(
    `  quota .............. ${quotaBefore.realRequests}/${quotaBefore.limit} reais, ${quotaBefore.cachedRequests} cacheadas, ${quotaBefore.remaining} restantes\n`
  );

  if (!args.dryRun && quotaBefore.remaining <= QUOTA_FLOOR) {
    console.error(
      `✗ Aborto: quota baixa demais (remaining=${quotaBefore.remaining} ≤ ${QUOTA_FLOOR}).`
    );
    process.exit(2);
  }

  // 2. Candidatos
  const candidates = await getFinishedFixturesMissingPlayerStats({
    limit: args.limit,
    daysBack: args.daysBack,
  });

  console.log(`→ Candidatos elegíveis (${candidates.length}):`);
  for (const c of candidates) {
    console.log(
      `   ${c.api_fixture_id}  ${c.kickoff_at ?? "?"}  ${c.league_name ?? "?"} :: ${c.home_team_name ?? "?"} × ${c.away_team_name ?? "?"}`
    );
  }
  if (candidates.length === 0) {
    console.log(
      "\n(nenhum candidato — janela limpa ou tudo já tem stats)"
    );
  }

  if (args.dryRun) {
    console.log(
      `\n[dryRun] custo estimado se rodar real: ${candidates.length} requests reais.`
    );
    console.log(
      "[dryRun] para coletar de verdade: --dryRun=false\n"
    );
    process.exit(0);
  }

  // 3. Execução real
  let okCount = 0;
  let lowCoverage = 0;
  let errCount = 0;
  let stoppedByPlan = false;
  let totalDupPlayers = 0;
  let totalDupStats = 0;
  let totalInvalidPlayers = 0;

  for (const c of candidates) {
    const q = await getQuotaSummary();
    if (q.remaining <= QUOTA_FLOOR) {
      console.warn(
        `\n⚠ Quota cruzou o floor (${q.remaining} ≤ ${QUOTA_FLOOR}). Parando.`
      );
      break;
    }
    try {
      const r = await syncFixturePlayerStats(c.api_fixture_id);
      totalDupPlayers += r.duplicate_players_dropped;
      totalDupStats += r.duplicate_stats_dropped;
      totalInvalidPlayers += r.invalid_players_skipped;
      const dupNote =
        r.duplicate_players_dropped > 0 || r.duplicate_stats_dropped > 0
          ? `  duplicates removidos: ${r.duplicate_players_dropped}p/${r.duplicate_stats_dropped}s`
          : "";
      const invalidNote =
        r.invalid_players_skipped > 0
          ? `  invalid api_id pulados: ${r.invalid_players_skipped}`
          : "";
      if (r.total_player_stats > 0) {
        okCount++;
        console.log(
          `  ${c.api_fixture_id}  ✓ ${r.total_player_stats} player_stats  (${c.league_name ?? "?"})${dupNote}${invalidNote}`
        );
      } else {
        lowCoverage++;
        console.log(
          `  ${c.api_fixture_id}  ⚠ low-coverage (${c.league_name ?? "?"})${invalidNote}`
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isPlanLimitError(message)) {
        console.log(
          `\n⛔ ${c.api_fixture_id}: plano grátis bloqueia. Parando para preservar quota.`
        );
        stoppedByPlan = true;
        break;
      }
      errCount++;
      console.warn(
        `  ${c.api_fixture_id}  ✗ ERRO: ${message.slice(0, 120)}`
      );
    }
  }

  // 4. Snapshot DEPOIS + diff
  const after = await getPlayerHistoryCoverage();
  const quotaAfter = await getQuotaSummary();

  function arrow(b: number, a: number): string {
    if (a === b) return `${pad(b)} → ${pad(a)} (=)`;
    const delta = a - b;
    const sign = delta > 0 ? "+" : "";
    return `${pad(b)} → ${pad(a)} (${sign}${delta})`;
  }

  console.log("\n=== Cobertura DEPOIS (diff) ===");
  console.log(`  players ............ ${arrow(before.total_players, after.total_players)}`);
  console.log(`  player_stats ....... ${arrow(before.total_player_stats, after.total_player_stats)}`);
  console.log(`  com 1 jogo ......... ${arrow(before.with_one_match, after.with_one_match)}`);
  console.log(`  com 2 jogos ........ ${arrow(before.with_two_matches, after.with_two_matches)}`);
  console.log(`  com 3+ jogos ....... ${arrow(before.with_three_or_more, after.with_three_or_more)}`);

  if (after.top_leagues.length > 0) {
    console.log("\n→ Top ligas por player_stats (depois):");
    for (const l of after.top_leagues.slice(0, 10)) {
      console.log(
        `   ${pad(l.player_stats_count)}  ${l.league_name}`
      );
    }
  }

  console.log("\n=== Resumo execução ===");
  console.log(`  Fixtures com stats salvos:  ${okCount}`);
  console.log(`  Fixtures sem cobertura:     ${lowCoverage}`);
  console.log(`  Fixtures com erro:          ${errCount}`);
  if (stoppedByPlan) console.log(`  Parado pelo plano:          sim`);
  console.log(`  Duplicates players removidos: ${totalDupPlayers}`);
  console.log(`  Duplicates stats removidos:   ${totalDupStats}`);
  console.log(`  Invalid api_id pulados:       ${totalInvalidPlayers}`);
  console.log(
    `  Quota antes:                ${quotaBefore.realRequests}/${quotaBefore.limit} (${quotaBefore.remaining} restantes)`
  );
  console.log(
    `  Quota depois:               ${quotaAfter.realRequests}/${quotaAfter.limit} (${quotaAfter.remaining} restantes)`
  );
  console.log(
    `  Reais consumidas:           ${quotaAfter.realRequests - quotaBefore.realRequests}`
  );

  process.exit(errCount > 0 && okCount === 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\n✗ Erro fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
