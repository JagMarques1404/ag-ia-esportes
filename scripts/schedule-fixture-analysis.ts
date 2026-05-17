/**
 * Schedule fixture analysis — Fase E.0A.9.
 *
 *   npm run schedule:fixtures -- --date=YYYY-MM-DD --dryRun=true
 *   npm run schedule:fixtures -- --date=YYYY-MM-DD --dryRun=false
 *
 * Lê fixtures da data filtrando por catálogo `is_auto_pick=true` e
 * cria/atualiza linha em `fixture_analysis_schedule` com status='scheduled'.
 *
 * Não chama API. Não gera picks. Apenas planeja.
 *
 * Idempotente: UPSERT por (api_fixture_id).
 *
 * Janelas calculadas pelo worker (não aqui):
 *   T-24h  → prepare (precheck básico se faltar)
 *   T-2h   → lineup_pending
 *   T-1h   → lineup confirmation
 *   T-30m  → board final
 *   T-15m  → picks draft
 */
process.env.AG_IA_SCRIPT_MODE = "true";

import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), ".env.local"), override: true });

interface CliArgs {
  date: string;
  dryRun: boolean;
  maxFixtures: number;
}

function parseArgs(): CliArgs {
  const argMap = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([a-zA-Z][a-zA-Z0-9-]*)(?:=(.+))?$/);
    if (m) argMap.set(m[1], m[2] ?? "true");
  }
  const date = argMap.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("--date=YYYY-MM-DD é obrigatório.");
  }
  const dryRunRaw = argMap.get("dryRun");
  const dryRun = dryRunRaw === undefined ? true : dryRunRaw !== "false";
  const maxFixtures = Number.parseInt(argMap.get("maxFixtures") ?? "100", 10);
  return {
    date,
    dryRun,
    maxFixtures: Number.isFinite(maxFixtures) ? maxFixtures : 100,
  };
}

async function main() {
  const args = parseArgs();
  console.log(
    `→ schedule-fixture-analysis date=${args.date} dryRun=${args.dryRun} max=${args.maxFixtures}\n`
  );

  const { getSupabaseAdmin } = await import("../lib/supabase/admin");
  const sb = getSupabaseAdmin();

  // Janela: date OR kickoff_at em range BR (UTC-3)
  const dayStart = `${args.date}T03:00:00Z`;
  const nextDate = (() => {
    const d = new Date(`${args.date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().split("T")[0];
  })();
  const dayEnd = `${nextDate}T03:00:00Z`;

  // Catálogo
  const { data: catalogIds } = await sb
    .from("football_leagues_catalog")
    .select("api_league_id")
    .eq("is_auto_pick", true);
  const autoPickIds = (catalogIds ?? [])
    .map((r) => Number(r.api_league_id))
    .filter((n) => Number.isFinite(n));

  function buildQ() {
    let q = sb
      .from("football_fixtures")
      .select(
        "id, api_fixture_id, league_name, home_team_name, away_team_name, kickoff_at, date"
      )
      .order("kickoff_at", { ascending: true, nullsFirst: false });
    if (autoPickIds.length > 0) q = q.in("api_league_id", autoPickIds);
    return q;
  }
  const [byDate, byKick] = await Promise.all([
    buildQ().eq("date", args.date),
    buildQ().gte("kickoff_at", dayStart).lt("kickoff_at", dayEnd),
  ]);

  interface FxRow {
    id: string;
    api_fixture_id: number;
    league_name: string | null;
    home_team_name: string | null;
    away_team_name: string | null;
    kickoff_at: string | null;
    date: string | null;
  }
  const merged = new Map<number, FxRow>();
  for (const r of (byDate.data ?? []) as FxRow[]) merged.set(r.api_fixture_id, r);
  for (const r of (byKick.data ?? []) as FxRow[])
    if (!merged.has(r.api_fixture_id)) merged.set(r.api_fixture_id, r);
  const fixtures = Array.from(merged.values())
    .sort((a, b) => (a.kickoff_at ?? "").localeCompare(b.kickoff_at ?? ""))
    .slice(0, args.maxFixtures);

  console.log(
    `→ ${fixtures.length} fixtures alvo (date=${(byDate.data ?? []).length}, kickoff=${(byKick.data ?? []).length}, catálogo=${autoPickIds.length})`
  );

  if (fixtures.length === 0) {
    console.log("   (nada para agendar — rode sync de fixtures antes)");
    process.exit(0);
  }

  // Mostra plano
  for (const fx of fixtures) {
    console.log(
      `   ${fx.api_fixture_id}  ${fx.league_name?.padEnd(20) ?? "?".padEnd(20)} ${fx.home_team_name} × ${fx.away_team_name}  ${fx.kickoff_at ?? "?"}`
    );
  }

  if (args.dryRun) {
    console.log(`\n[dryRun] sem writes. Para aplicar:`);
    console.log(
      `   npm run schedule:fixtures -- --date=${args.date} --dryRun=false`
    );
    process.exit(0);
  }

  // UPSERT em fixture_analysis_schedule
  const rows = fixtures.map((fx) => ({
    api_fixture_id: fx.api_fixture_id,
    fixture_id: fx.id,
    match_name: `${fx.home_team_name ?? "?"} × ${fx.away_team_name ?? "?"}`,
    league_name: fx.league_name,
    kickoff_at: fx.kickoff_at,
    status: "scheduled",
  }));
  const { error } = await sb
    .from("fixture_analysis_schedule")
    .upsert(rows, { onConflict: "api_fixture_id" });
  if (error) {
    console.error(`✗ upsert: ${error.message}`);
    process.exit(1);
  }

  console.log(`\n✓ ${rows.length} fixtures agendados`);
  console.log(
    `\n→ Próximo: rodar worker para começar a coletar.\n   npm run worker:fixture-analysis -- --dryRun=false`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("\n✗ Erro fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
