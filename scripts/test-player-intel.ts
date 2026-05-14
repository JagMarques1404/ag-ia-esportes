/**
 * Smoke test do Player Intelligence Engine.
 *
 *   npm run test:player-intel -- --fixture=1531977
 *   npm run test:player-intel -- --fixture=1531977 --sync
 *
 * Por padrão NÃO chama a API-Football — só lê o que já está no banco.
 * Se passar --sync, dispara syncFixtureLineups + syncFixturePlayerStats
 * antes (gasta 2 requests reais por fixture).
 *
 * Sem stats no banco e sem --sync, todos os jogadores vão ter
 * sample_size=0 e probability ≈ 0. É esperado.
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

async function main() {
  const { apiFixtureId, syncFirst } = parseArgs();
  const { runFixturePlayerIntel } = await import("../lib/player-intel");
  const { syncFixtureLineups, syncFixturePlayerStats } = await import(
    "../lib/api-football/sync"
  );
  const { getQuotaSummary } = await import("../lib/api-football/quota");

  console.log(`→ Player Intel para fixture ${apiFixtureId}\n`);

  if (syncFirst) {
    console.log("→ --sync ativo: chamando lineups + player stats da API...");
    const before = await getQuotaSummary();
    console.log(
      `   quota antes: ${before.realRequests}/${before.limit} reais, ${before.remaining} restantes`
    );
    try {
      const lu = await syncFixtureLineups(apiFixtureId);
      console.log(
        `   ✓ lineups: ${lu.total_lineups} times, ${lu.total_players} jogadores`
      );
    } catch (err) {
      console.warn(
        `   ⚠ lineups falhou: ${err instanceof Error ? err.message : err}`
      );
    }
    try {
      const ps = await syncFixturePlayerStats(apiFixtureId);
      console.log(`   ✓ player stats: ${ps.total_player_stats} registros`);
    } catch (err) {
      console.warn(
        `   ⚠ player stats falhou: ${err instanceof Error ? err.message : err}`
      );
    }
    const after = await getQuotaSummary();
    console.log(
      `   quota depois: ${after.realRequests}/${after.limit} reais, ${after.remaining} restantes\n`
    );
  }

  const result = await runFixturePlayerIntel(apiFixtureId);

  console.log("✓ Pipeline player-intel concluído:");
  console.log(`   jogadores analisados: ${result.players_analyzed}`);
  console.log(`   matchups gerados:     ${result.matchups_built}`);
  console.log(`   probabilidades:       ${result.probabilities_generated}`);
  console.log(`   data_quality média:   ${result.data_quality_avg}`);

  if (result.warnings.length > 0) {
    console.log("\n⚠ Warnings:");
    for (const w of result.warnings) console.log(`   ${w}`);
  }

  // Top 20 por probability × confidence
  const ranked = [...result.probabilities]
    .sort(
      (a, b) =>
        b.probability * b.confidence_score -
        a.probability * a.confidence_score
    )
    .slice(0, 20);
  if (ranked.length > 0) {
    console.log("\n→ Top 20 ações individuais (rank = prob × confidence):");
    for (const p of ranked) {
      const odd = p.fair_odd ? p.fair_odd.toFixed(2) : "—";
      console.log(
        `   [prob ${p.probability.toFixed(3)} | conf ${p.confidence_score.toFixed(2)} | dq ${p.data_quality_score.toFixed(2)} | mu ${p.matchup_score.toFixed(2)} | fair@${odd}] ${p.action_key} :: ${p.player_name}`
      );
    }
  } else {
    console.log("\n(sem probabilidades — provavelmente lineup vazio)");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("\n✗ Erro:", err instanceof Error ? err.message : err);
  process.exit(1);
});
