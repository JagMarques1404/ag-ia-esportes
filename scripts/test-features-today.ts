/**
 * Smoke test da Fase 3 (Feature + Probability Engine).
 *
 * Roda buildDailyValueBoard(today) usando dados já presentes em
 * football_fixtures. Não chama a API-Football — depende de fixtures
 * já sincronizados (rode `npm run test:fixtures:today` antes se
 * o banco do dia estiver vazio).
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
  const { getSupabaseAdmin } = await import("../lib/supabase/admin");

  const today = todayString();

  // 1. Garantir que existem fixtures do dia
  const supabase = getSupabaseAdmin();
  const { count: fixtureCount } = await supabase
    .from("football_fixtures")
    .select("*", { count: "exact", head: true })
    .eq("date", today);

  console.log(`→ Fixtures de ${today} no banco: ${fixtureCount ?? 0}`);
  if (!fixtureCount || fixtureCount === 0) {
    console.warn(
      "⚠  Nenhum fixture do dia. Rode `npm run test:fixtures:today` antes."
    );
    process.exit(2);
  }

  // 2. Construir o value board
  console.log(`→ Construindo daily value board para ${today}...\n`);
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
    console.log("\n⚠  Falhas (até 5 primeiras):");
    for (const f of result.failures.slice(0, 5)) {
      console.log(`   api_fixture_id=${f.api_fixture_id}: ${f.error}`);
    }
  }

  // 3. Top 10 por categoria
  const board = await getDailyValueBoard(today);
  type Row = (typeof board)[number];
  const groups: Record<string, Row[]> = {
    safe: [],
    intermediate: [],
    advanced: [],
    watchlist: [],
    mega: [],
  };
  for (const r of board) {
    groups[r.category]?.push(r);
  }

  for (const [cat, rows] of Object.entries(groups)) {
    if (rows.length === 0) continue;
    console.log(`\n→ Top 10 ${cat.toUpperCase()} (de ${rows.length}):`);
    for (const r of rows.slice(0, 10)) {
      const odd = r.fair_odd ? r.fair_odd.toFixed(2) : "—";
      console.log(
        `   [${r.probability.toFixed(3)} | conf ${r.confidence_score.toFixed(2)} | dq ${r.data_quality_score.toFixed(2)} | rank ${r.rank_score.toFixed(3)} | fair@${odd}] ${r.market_key} :: ${r.home_team_name ?? "?"} × ${r.away_team_name ?? "?"} (${r.league_name ?? "?"})`
      );
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("\n✗ Erro fatal:");
  console.error(err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) {
    console.error("\nStack:");
    console.error(err.stack);
  }
  process.exit(1);
});
