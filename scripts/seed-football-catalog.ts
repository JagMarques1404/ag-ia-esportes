/**
 * Seed estático do football_leagues_catalog (Fase E.0A.2).
 *
 *   npm run seed:football-catalog -- --dryRun=true
 *   npm run seed:football-catalog -- --dryRun=false
 *
 * Motivação: o plano free do API-Football bloqueia /leagues?season=,
 * deixando o sync:football-catalog sem como popular o catálogo. Este
 * script usa uma lista estática de IDs canônicos verificados.
 *
 * Fluxo:
 *   1. Lê o estado atual de football_leagues_catalog.
 *   2. Lê quais (api_league_id, league_name) já apareceram em
 *      football_fixtures — usado para detectar conflitos (ex.: várias
 *      "Premier League" diferentes vindas do provider).
 *   3. Mostra o plano de upsert: 14 ligas com IDs canônicos.
 *   4. Em dryRun=false: faz UPSERT.
 *
 * Não chama API externa. Não consome quota. Idempotente.
 */
process.env.AG_IA_SCRIPT_MODE = "true";

import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), ".env.local"), override: true });

interface CliArgs {
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const argMap = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([a-zA-Z][a-zA-Z0-9-]*)(?:=(.+))?$/);
    if (m) argMap.set(m[1], m[2] ?? "true");
  }
  const dryRunRaw = argMap.get("dryRun");
  const dryRun = dryRunRaw === undefined ? true : dryRunRaw !== "false";
  return { dryRun };
}

async function main() {
  const args = parseArgs();
  console.log(`→ seed-football-catalog dryRun=${args.dryRun}\n`);

  const { getSupabaseAdmin } = await import("../lib/supabase/admin");
  const { SEEDED_AUTO_PICK_LEAGUES } = await import(
    "../lib/football-data/priority-leagues"
  );
  const sb = getSupabaseAdmin();

  // ============================================================
  // 1. Estado atual do catálogo
  // ============================================================
  const { count: catalogCount } = await sb
    .from("football_leagues_catalog")
    .select("*", { count: "exact", head: true });
  const { count: autoPickCount } = await sb
    .from("football_leagues_catalog")
    .select("*", { count: "exact", head: true })
    .eq("is_auto_pick", true);

  console.log(`=== Estado atual ===`);
  console.log(`  football_leagues_catalog total:    ${catalogCount ?? 0}`);
  console.log(`  is_auto_pick=true:                 ${autoPickCount ?? 0}`);

  // ============================================================
  // 2. Conflitos no banco — agrupar fixtures por (api_league_id, league_name)
  // ============================================================
  const { data: fixtureLeagues } = await sb
    .from("football_fixtures")
    .select("api_league_id, league_name")
    .not("api_league_id", "is", null);

  const byName = new Map<string, Set<number>>();   // name → set of ids
  const byId = new Map<number, string>();          // id → first name seen
  for (const row of (fixtureLeagues ?? []) as Array<{
    api_league_id: number | null;
    league_name: string | null;
  }>) {
    if (row.api_league_id == null) continue;
    const name = (row.league_name ?? "?").trim();
    if (!byName.has(name)) byName.set(name, new Set());
    byName.get(name)!.add(row.api_league_id);
    if (!byId.has(row.api_league_id)) byId.set(row.api_league_id, name);
  }

  const conflicts = Array.from(byName.entries())
    .filter(([, ids]) => ids.size > 1)
    .sort((a, b) => b[1].size - a[1].size);

  console.log(
    `\n=== Conflitos detectados em football_fixtures (${conflicts.length}) ===`
  );
  if (conflicts.length === 0) {
    console.log("  (nenhum — nenhum nome de liga aparece com mais de um id)");
  } else {
    for (const [name, ids] of conflicts) {
      console.log(
        `  ⚠ "${name}" tem ${ids.size} IDs distintos: ${Array.from(ids).sort((a, b) => a - b).join(", ")}`
      );
    }
  }

  // ============================================================
  // 3. Plano de upsert
  // ============================================================
  console.log(`\n=== Plano de upsert (${SEEDED_AUTO_PICK_LEAGUES.length} ligas) ===`);
  for (const l of SEEDED_AUTO_PICK_LEAGUES) {
    const localName = byId.get(l.api_league_id) ?? null;
    const localTag =
      localName == null
        ? "[sem fixtures locais ainda]"
        : localName === l.name
          ? "[bate local]"
          : `[local: "${localName}"]`;
    console.log(
      `  id=${String(l.api_league_id).padStart(4)}  ${l.name.padEnd(30)} ${l.country.padEnd(12)} ${localTag}`
    );
  }

  // Avisa quando IDs canônicos NÃO bateram com nenhum fixture local —
  // pode ser legítimo (jogo da liga ainda não foi sincronizado) ou drift
  // de ID. Reporta como warning para o usuário decidir.
  const seededIds = new Set(SEEDED_AUTO_PICK_LEAGUES.map((l) => l.api_league_id));
  const notSeenLocally = SEEDED_AUTO_PICK_LEAGUES.filter(
    (l) => !byId.has(l.api_league_id)
  );
  if (notSeenLocally.length > 0) {
    console.log(
      `\n  ℹ ${notSeenLocally.length} dos IDs canônicos NÃO aparecem em football_fixtures (pode ser normal se nunca sincronizou a liga).`
    );
  }

  // Avisa quando o banco tem IDs com nomes que parecem das ligas seed,
  // MAS o ID não bate com o canônico — sinaliza possível drift.
  const suspectMismatches: Array<{
    seedName: string;
    seedId: number;
    localIds: number[];
  }> = [];
  for (const l of SEEDED_AUTO_PICK_LEAGUES) {
    const localIdsForName = Array.from(byName.get(l.name) ?? []);
    const driftedIds = localIdsForName.filter((id) => !seededIds.has(id));
    if (driftedIds.length > 0) {
      suspectMismatches.push({
        seedName: l.name,
        seedId: l.api_league_id,
        localIds: driftedIds,
      });
    }
  }
  if (suspectMismatches.length > 0) {
    console.log(
      `\n=== Possíveis homônimos regionais ignorados pelo seed ===`
    );
    for (const s of suspectMismatches) {
      console.log(
        `  "${s.seedName}" (canônico ${s.seedId}) — local também tem id(s): ${s.localIds.join(", ")}`
      );
    }
    console.log(
      `  → esses IDs não ganham is_auto_pick=true. Filtragem do daily:auto-picks fica limpa.`
    );
  }

  // ============================================================
  // 4. Execução
  // ============================================================
  if (args.dryRun) {
    console.log(`\n[dryRun] sem writes. Para aplicar:`);
    console.log(`   npm run seed:football-catalog -- --dryRun=false`);
    process.exit(0);
  }

  const SEED_SEASONS = [{ year: 2025 }, { year: 2026 }];
  const rows = SEEDED_AUTO_PICK_LEAGUES.map((l) => ({
    api_league_id: l.api_league_id,
    name: l.name,
    type: l.type,
    country: l.country,
    country_code: l.country_code,
    seasons: SEED_SEASONS as unknown as object,
    is_auto_pick: true,
    coverage_level: "seeded",
  }));

  const { error } = await sb
    .from("football_leagues_catalog")
    .upsert(rows, { onConflict: "api_league_id" });
  if (error) {
    console.error(`\n✗ upsert falhou: ${error.message}`);
    process.exit(1);
  }
  console.log(`\n✓ upsert: ${rows.length} ligas seedadas`);

  const { count: autoAfter } = await sb
    .from("football_leagues_catalog")
    .select("*", { count: "exact", head: true })
    .eq("is_auto_pick", true);
  console.log(`  is_auto_pick=true (após):          ${autoAfter ?? 0}`);

  console.log("\n→ Próximo passo:");
  console.log(
    `   npm run daily:auto-picks -- --date=<DATA> --dryRun=true   (agora filtra por catálogo)`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("\n✗ Erro fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
