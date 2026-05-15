/**
 * Smoke test do Player Action Board v0.2.
 *
 *   npm run test:player-action-board -- --fixture=API_FIXTURE_ID
 *   npm run test:player-action-board -- --fixture=API_FIXTURE_ID --sync
 *
 * Sem --sync: só lê o que já está em football_player_action_probabilities
 * para o fixture, mostra ranking. Não chama API.
 *
 * Com --sync: chama syncFixtureLineups + syncFixturePlayerStats antes
 * (2 reqs reais), depois runFixturePlayerIntel (escreve no banco),
 * depois lê e mostra.
 */
process.env.AG_IA_SCRIPT_MODE = "true";

import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), ".env.local"), override: true });

interface CliArgs {
  apiFixtureId: number;
  syncFirst: boolean;
}

function parseArgs(): CliArgs {
  const argMap = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([a-zA-Z][a-zA-Z0-9-]*)(?:=(.+))?$/);
    if (m) argMap.set(m[1], m[2] ?? "true");
  }
  const raw = argMap.get("fixture");
  if (!raw) {
    throw new Error(
      "--fixture=API_FIXTURE_ID é obrigatório. Ex.: --fixture=1531977"
    );
  }
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error(`--fixture inválido: ${raw}`);
  }
  return { apiFixtureId: id, syncFirst: argMap.get("sync") === "true" };
}

interface BoardRow {
  api_player_id: number | null;
  player_name: string;
  action_key: string;
  line: number;
  probability: number;
  fair_odd: number | null;
  odd_market: number | null;
  edge: number | null;
  confidence_score: number;
  data_quality_score: number;
  sample_size: number;
  hit_rate: number | null;
  avg_value: number | null;
  last5_values: unknown;
  recommendation: string | null;
  data_origin: string | null;
  rationale: string | null;
}

function fmt(n: number | null | undefined, digits = 3): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(0)}%`;
}

async function main() {
  const { apiFixtureId, syncFirst } = parseArgs();
  const { getSupabaseAdmin } = await import("../lib/supabase/admin");

  console.log(`→ Player Action Board fixture=${apiFixtureId} sync=${syncFirst}\n`);

  if (syncFirst) {
    const { syncFixtureLineups, syncFixturePlayerStats } = await import(
      "../lib/api-football/sync"
    );
    const { getQuotaSummary } = await import("../lib/api-football/quota");
    const before = await getQuotaSummary();
    console.log(
      `→ quota antes: ${before.realRequests}/${before.limit} reais, ${before.remaining} restantes`
    );
    try {
      const lu = await syncFixtureLineups(apiFixtureId);
      console.log(`   ✓ lineups: ${lu.total_lineups} teams, ${lu.total_players} jogadores`);
    } catch (err) {
      console.warn(`   ⚠ lineups: ${err instanceof Error ? err.message : err}`);
    }
    try {
      const ps = await syncFixturePlayerStats(apiFixtureId);
      console.log(`   ✓ player stats: ${ps.total_player_stats} registros`);
    } catch (err) {
      console.warn(`   ⚠ player stats: ${err instanceof Error ? err.message : err}`);
    }
    const after = await getQuotaSummary();
    console.log(
      `→ quota depois: ${after.realRequests}/${after.limit} reais, ${after.remaining} restantes\n`
    );
  }

  // Roda o orquestrador (escreve no banco). Idempotente.
  const { runFixturePlayerIntel } = await import("../lib/player-intel");
  console.log("→ runFixturePlayerIntel...");
  let result: { players_analyzed: number; matchups_built: number; probabilities_generated: number; data_quality_avg: number; warnings: string[] };
  try {
    result = await runFixturePlayerIntel(apiFixtureId);
    console.log(
      `   ✓ ${result.players_analyzed} jogadores · ${result.matchups_built} matchups · ${result.probabilities_generated} probabilidades · dq médio ${result.data_quality_avg}`
    );
    if (result.warnings.length > 0) {
      console.warn(`   ⚠ warnings:`);
      for (const w of result.warnings.slice(0, 5)) console.warn(`     ${w}`);
    }
  } catch (err) {
    console.error(`   ✗ ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  // Lê do banco para exibir.
  const sb = getSupabaseAdmin();
  const { data: rows } = await sb
    .from("football_player_action_probabilities")
    .select(
      "api_player_id, player_name, action_key, line, probability, fair_odd, odd_market, edge, confidence_score, data_quality_score, sample_size, hit_rate, avg_value, last5_values, recommendation, data_origin, rationale"
    )
    .eq("api_fixture_id", apiFixtureId)
    .order("probability", { ascending: false });
  const board = (rows ?? []) as BoardRow[];

  if (board.length === 0) {
    console.log("\n(sem linhas no board — pode ser que o fixture não tenha lineup salvo)");
    process.exit(0);
  }

  // ============================================================
  // Estatísticas
  // ============================================================
  const byRec: Record<string, number> = {};
  const byOrigin: Record<string, number> = {};
  const playersWithSample = new Set<number>();
  const playersZeroSample = new Set<number>();
  for (const r of board) {
    byRec[r.recommendation ?? "?"] = (byRec[r.recommendation ?? "?"] ?? 0) + 1;
    byOrigin[r.data_origin ?? "?"] = (byOrigin[r.data_origin ?? "?"] ?? 0) + 1;
    if (r.api_player_id != null) {
      if (r.sample_size > 0) playersWithSample.add(r.api_player_id);
      else playersZeroSample.add(r.api_player_id);
    }
  }

  console.log(`\n=== Board ===`);
  console.log(`  linhas geradas: ${board.length}`);
  console.log(`  recomendação:`);
  for (const k of Object.keys(byRec).sort()) {
    console.log(`     ${k.padEnd(12)} ${byRec[k]}`);
  }
  console.log(`  data origin:`);
  for (const k of Object.keys(byOrigin).sort()) {
    console.log(`     ${k.padEnd(12)} ${byOrigin[k]}`);
  }
  console.log(`  jogadores com histórico: ${playersWithSample.size}`);
  console.log(`  jogadores sem histórico: ${playersZeroSample.size}`);

  // ============================================================
  // Top 20 por probability
  // ============================================================
  console.log(`\n=== Top 20 por probability ===`);
  console.log(
    "rank prob  conf  dq   sample hit   avg   action            line  player                  rec"
  );
  const top = board.slice(0, 20);
  top.forEach((r, i) => {
    console.log(
      [
        String(i + 1).padStart(3),
        fmt(r.probability, 3).padStart(5),
        fmt(r.confidence_score, 2).padStart(4),
        fmt(r.data_quality_score, 2).padStart(4),
        String(r.sample_size).padStart(6),
        fmtPct(r.hit_rate).padStart(4),
        fmt(r.avg_value, 2).padStart(5),
        r.action_key.padEnd(17),
        fmt(r.line, 1).padStart(4),
        (r.player_name ?? "?").slice(0, 22).padEnd(22),
        r.recommendation ?? "?",
      ].join(" ")
    );
  });

  // ============================================================
  // Top 20 por edge (precisa de odd_market)
  // ============================================================
  const withEdge = board
    .filter((r) => r.edge != null)
    .sort((a, b) => (b.edge as number) - (a.edge as number));
  console.log(
    `\n=== Top 20 por edge ${withEdge.length === 0 ? "(SEM odd_market salvo ainda — board sem edge)" : ""} ===`
  );
  if (withEdge.length > 0) {
    console.log(
      "rank edge  prob  odd  action            line  player                  rec"
    );
    withEdge.slice(0, 20).forEach((r, i) => {
      console.log(
        [
          String(i + 1).padStart(3),
          fmt(r.edge, 3).padStart(5),
          fmt(r.probability, 3).padStart(5),
          fmt(r.odd_market, 2).padStart(4),
          r.action_key.padEnd(17),
          fmt(r.line, 1).padStart(4),
          (r.player_name ?? "?").slice(0, 22).padEnd(22),
          r.recommendation ?? "?",
        ].join(" ")
      );
    });
  }

  // ============================================================
  // Exemplos com last5_values
  // ============================================================
  const withSeries = board.filter((r) => {
    const arr = Array.isArray(r.last5_values) ? (r.last5_values as unknown[]) : [];
    return arr.length > 0;
  });
  console.log(
    `\n=== Exemplos com last5_values (${withSeries.length} de ${board.length}) ===`
  );
  withSeries.slice(0, 5).forEach((r) => {
    const arr = (r.last5_values as number[]) ?? [];
    console.log(
      `  ${(r.player_name ?? "?").slice(0, 22).padEnd(22)} ${r.action_key.padEnd(15)} [${arr.join(", ")}] avg=${fmt(r.avg_value, 2)} hit@line=${fmtPct(r.hit_rate)}`
    );
  });

  // Jogadores sem histórico
  if (playersZeroSample.size > 0) {
    console.log(
      `\n⚠ ${playersZeroSample.size} jogadores ainda sem histórico (sample=0). Considere rodar collect:player-history nas ligas relevantes.`
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("\n✗ Erro fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
