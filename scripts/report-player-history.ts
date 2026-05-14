/**
 * Relatório de cobertura de histórico individual.
 * Não chama API. Lê apenas o banco.
 *
 *   npm run report:player-history
 */
process.env.AG_IA_SCRIPT_MODE = "true";

import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), ".env.local"), override: true });

async function main() {
  const { getPlayerHistoryCoverage } = await import(
    "../lib/player-intel/history-candidates"
  );

  const c = await getPlayerHistoryCoverage();

  console.log("=== Cobertura de histórico individual ===");
  console.log(`Players (football_players):       ${c.total_players}`);
  console.log(`Player stats (player_match_stats): ${c.total_player_stats}`);
  console.log(`Jogadores com 1 jogo:             ${c.with_one_match}`);
  console.log(`Jogadores com 2 jogos:            ${c.with_two_matches}`);
  console.log(`Jogadores com 3+ jogos:           ${c.with_three_or_more}`);

  if (c.top_by_sample.length > 0) {
    console.log("\n→ Top 20 jogadores por sample_size:");
    for (const p of c.top_by_sample) {
      console.log(
        `   ${String(p.sample_size).padStart(3)}  ${p.player_name ?? "?"}  (api=${p.api_player_id})`
      );
    }
  }

  if (c.top_leagues.length > 0) {
    console.log("\n→ Top 20 ligas por player_stats:");
    for (const l of c.top_leagues) {
      console.log(
        `   ${String(l.player_stats_count).padStart(4)}  ${l.league_name}`
      );
    }
  }

  if (c.total_player_stats === 0) {
    console.log(
      "\n⚠ Nenhum player_stats no banco ainda. Rode `npm run collect:player-history -- --limit=3` para começar."
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("\n✗ Erro fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
