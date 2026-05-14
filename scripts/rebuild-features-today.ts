/**
 * Recalcula o daily value board de hoje a partir do que já está em
 * football_fixtures (sem chamar a API-Football). Útil rodar logo
 * após `npm run backfill:fixtures` para ver as categorias se moverem
 * de watchlist para safe/intermediate/advanced.
 */
process.env.AG_IA_SCRIPT_MODE = "true";

import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), ".env.local"), override: true });

function todayString(): string {
  return new Date().toISOString().split("T")[0];
}

async function main() {
  const { buildDailyValueBoard, getDailyValueBoard } = await import(
    "../lib/features/value-board"
  );

  const today = todayString();
  console.log(`→ Reconstruindo daily value board para ${today}...\n`);

  const result = await buildDailyValueBoard(today);

  console.log("✓ Build concluído:");
  console.log(`   fixtures processados:  ${result.fixtures_processed}`);
  console.log(`   fixtures com erro:     ${result.fixtures_failed}`);
  console.log(`   probabilidades:        ${result.probabilities_generated}`);
  console.log(`   linhas no board:       ${result.board_rows_inserted}`);
  console.log(`   data quality média:    ${result.avg_data_quality}`);
  console.log("\n→ Categorias:");
  for (const [cat, n] of Object.entries(result.category_counts)) {
    console.log(`   ${cat.padEnd(13)} ${n}`);
  }

  if (result.failures.length > 0) {
    console.log(`\n⚠  ${result.failures.length} falhas (até 5 primeiras):`);
    for (const f of result.failures.slice(0, 5)) {
      console.log(`   api_fixture_id=${f.api_fixture_id}: ${f.error.slice(0, 120)}`);
    }
  }

  // Top 10 por rank_score (independente de categoria)
  const board = await getDailyValueBoard(today);
  const top = board.slice(0, 10);
  if (top.length > 0) {
    console.log("\n→ Top 10 por rank_score:");
    for (const r of top) {
      const odd = r.fair_odd ? r.fair_odd.toFixed(2) : "—";
      console.log(
        `   [${r.category.padEnd(12)} | rank ${r.rank_score.toFixed(3)} | prob ${r.probability.toFixed(3)} | conf ${r.confidence_score.toFixed(2)} | dq ${r.data_quality_score.toFixed(2)} | fair@${odd}] ${r.market_key} :: ${r.home_team_name ?? "?"} × ${r.away_team_name ?? "?"} (${r.league_name ?? "?"})`
      );
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("\n✗ Erro fatal:", err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
