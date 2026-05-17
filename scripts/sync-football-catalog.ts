/**
 * Sync football catalog — Fase E.0A.1.
 *
 *   npm run sync:football-catalog -- --season=2026 --dryRun=true
 *   npm run sync:football-catalog -- --season=2026 --dryRun=false
 *
 * Fluxo (dryRun=false):
 *   1. GET /leagues?season=N           (1 req)
 *   2. Upsert TODAS as ligas em football_leagues_catalog.
 *   3. Marcar is_auto_pick=true para entradas que casam com
 *      AUTO_PICK_LEAGUES_CANONICAL (name + country).
 *   4. Para cada liga auto_pick, GET /teams?league=ID&season=N (1 req cada).
 *   5. Upsert teams + ponte football_league_teams.
 *
 * dryRun=true:
 *   - Não chama API.
 *   - Mostra: status do catálogo local, quantas ligas auto_pick ESPERADAS
 *     pela lista canônica, estimativa de requests se rodasse real.
 *
 * Guard: respeita QUOTA_FLOOR=30 (não inicia ciclo de teams se quota
 * cair abaixo disso).
 */
process.env.AG_IA_SCRIPT_MODE = "true";

import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), ".env.local"), override: true });

interface CliArgs {
  season: number;
  dryRun: boolean;
}

// QUOTA_FLOOR vem de env (API_FOOTBALL_QUOTA_FLOOR, default Pro = 500).
let QUOTA_FLOOR = 500;

function parseArgs(): CliArgs {
  const argMap = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([a-zA-Z][a-zA-Z0-9-]*)(?:=(.+))?$/);
    if (m) argMap.set(m[1], m[2] ?? "true");
  }
  const rawSeason = argMap.get("season");
  const season = Number.parseInt(rawSeason ?? "", 10);
  if (!Number.isFinite(season) || season < 2000 || season > 2100) {
    throw new Error("--season=YYYY é obrigatório (ex.: --season=2026).");
  }
  const dryRunRaw = argMap.get("dryRun");
  const dryRun = dryRunRaw === undefined ? true : dryRunRaw !== "false";
  return { season, dryRun };
}

function isPlanLimitError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('"plan"') ||
    m.includes("free plan") ||
    m.includes("do not have access to this date")
  );
}

// Shape do envelope /leagues
interface LeagueBlock {
  league: {
    id: number;
    name: string;
    type?: string;
    logo?: string;
  };
  country: {
    name: string;
    code?: string | null;
    flag?: string | null;
  };
  seasons?: Array<{
    year: number;
    start?: string;
    end?: string;
    current?: boolean;
    coverage?: Record<string, unknown>;
  }>;
}

// Shape do envelope /teams?league=&season=
interface TeamBlock {
  team: {
    id: number;
    name: string;
    code?: string | null;
    country?: string | null;
    founded?: number | null;
    national?: boolean;
    logo?: string | null;
  };
  venue?: Record<string, unknown>;
}

async function main() {
  const args = parseArgs();
  console.log(
    `→ sync-football-catalog season=${args.season} dryRun=${args.dryRun}\n`
  );

  const { getSupabaseAdmin } = await import("../lib/supabase/admin");
  const { getQuotaSummary } = await import("../lib/api-football/quota");
  const { getApiQuotaFloor, getApiPlanName } = await import(
    "../lib/api-football/config"
  );
  const {
    AUTO_PICK_LEAGUES_CANONICAL,
    isCanonicalAutoPickLeague,
  } = await import("../lib/football-data/priority-leagues");
  QUOTA_FLOOR = getApiQuotaFloor();
  console.log(`→ plano=${getApiPlanName()} quota_floor=${QUOTA_FLOOR}`);
  const sb = getSupabaseAdmin();

  // ============================================================
  // Estado atual do catálogo
  // ============================================================
  const { count: leaguesCount } = await sb
    .from("football_leagues_catalog")
    .select("*", { count: "exact", head: true });
  const { count: autoPickCount } = await sb
    .from("football_leagues_catalog")
    .select("*", { count: "exact", head: true })
    .eq("is_auto_pick", true);
  const { count: teamsCount } = await sb
    .from("football_teams_catalog")
    .select("*", { count: "exact", head: true });
  const { count: leagueTeamsSeasonCount } = await sb
    .from("football_league_teams")
    .select("*", { count: "exact", head: true })
    .eq("season", args.season);

  console.log("=== Catálogo local atual ===");
  console.log(`  football_leagues_catalog: ${leaguesCount ?? 0}`);
  console.log(`    is_auto_pick=true:      ${autoPickCount ?? 0}`);
  console.log(`  football_teams_catalog:   ${teamsCount ?? 0}`);
  console.log(
    `  football_league_teams (season=${args.season}): ${leagueTeamsSeasonCount ?? 0}`
  );

  console.log("\n=== Canonical esperado ===");
  for (const entry of AUTO_PICK_LEAGUES_CANONICAL) {
    console.log(`   - ${entry.name.padEnd(30)} ${entry.country}`);
  }

  const quotaBefore = await getQuotaSummary().catch(() => null);
  if (quotaBefore) {
    console.log(
      `\n→ Quota atual: ${quotaBefore.realRequests}/${quotaBefore.limit} reais, ${quotaBefore.remaining} restantes`
    );
  }

  // Estimativa pessimista
  const estReqLeagues = 1;
  const estReqTeamsMax = AUTO_PICK_LEAGUES_CANONICAL.length; // 14
  const estTotal = estReqLeagues + estReqTeamsMax;
  console.log(`\n→ Custo estimado se rodar real:`);
  console.log(`   /leagues?season=${args.season}:        ${estReqLeagues}`);
  console.log(`   /teams?league=ID&season (1 por liga): ${estReqTeamsMax}`);
  console.log(`   total req real (pessimista):          ${estTotal}`);

  if (args.dryRun) {
    console.log(`\n[dryRun] sem chamadas à API. Para sincronizar real:`);
    console.log(
      `   npm run sync:football-catalog -- --season=${args.season} --dryRun=false`
    );
    process.exit(0);
  }

  if (quotaBefore && quotaBefore.remaining <= QUOTA_FLOOR) {
    console.error(
      `\n✗ Aborto: quota baixa (remaining=${quotaBefore.remaining} ≤ ${QUOTA_FLOOR}).`
    );
    process.exit(2);
  }

  // ============================================================
  // 1. /leagues?season=N
  // ============================================================
  const { apiFootballGet } = await import("../lib/api-football/client");
  let leaguesResp: { response: LeagueBlock[] } | null = null;
  try {
    console.log(`\n→ GET /leagues?season=${args.season}`);
    leaguesResp = await apiFootballGet<{ response: LeagueBlock[] }>(
      "/leagues",
      { season: args.season }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isPlanLimitError(msg)) {
      console.error(`\n⛔ Plano free do API-Football bloqueia /leagues?season=.`);
      console.error(`   Use o seed estático em vez disso:`);
      console.error(`     npm run seed:football-catalog -- --dryRun=false`);
      console.error(`   (popula as 14 ligas principais sem chamar API)`);
      process.exit(2);
    }
    console.error(`\n✗ /leagues falhou: ${msg.slice(0, 200)}`);
    process.exit(1);
  }

  const leagueBlocks = leaguesResp.response ?? [];
  console.log(`   ✓ ${leagueBlocks.length} ligas recebidas`);

  // ============================================================
  // 2. Upsert leagues + marcar is_auto_pick
  // ============================================================
  const rows = leagueBlocks.map((b) => {
    const isAuto = isCanonicalAutoPickLeague(b.league.name, b.country.name);
    const coverageLevel =
      b.seasons?.find((s) => s.year === args.season)?.coverage
        ? "documented"
        : "unknown";
    return {
      api_league_id: b.league.id,
      name: b.league.name,
      type: b.league.type ?? null,
      country: b.country.name ?? null,
      country_code: b.country.code ?? null,
      logo_url: b.league.logo ?? null,
      flag_url: b.country.flag ?? null,
      seasons: (b.seasons ?? []) as unknown as object,
      is_auto_pick: isAuto,
      is_priority: false, // mantido como False — flag separada usada pelo collect:player-last5
      coverage_level: coverageLevel,
    };
  });

  // Postgres não aceita arrays gigantes em 1 upsert sem hassle — paginar.
  const PAGE = 500;
  let upsertedLeagues = 0;
  for (let i = 0; i < rows.length; i += PAGE) {
    const slice = rows.slice(i, i + PAGE);
    const { error } = await sb
      .from("football_leagues_catalog")
      .upsert(slice, { onConflict: "api_league_id" });
    if (error) {
      console.error(`✗ upsert leagues (batch ${i}): ${error.message}`);
      process.exit(1);
    }
    upsertedLeagues += slice.length;
  }
  console.log(`   ✓ upsert leagues: ${upsertedLeagues}`);

  // Quantas ficaram marcadas
  const { data: autoLeagues } = await sb
    .from("football_leagues_catalog")
    .select("api_league_id, name, country")
    .eq("is_auto_pick", true)
    .order("country", { ascending: true });
  console.log(`\n=== Ligas marcadas como auto_pick (${autoLeagues?.length ?? 0}) ===`);
  for (const l of autoLeagues ?? []) {
    console.log(
      `   - id=${String(l.api_league_id).padStart(6)}  ${String(l.name).padEnd(30)} ${l.country}`
    );
  }

  if (!autoLeagues || autoLeagues.length === 0) {
    console.warn(
      "\n⚠ Nenhuma liga foi marcada — verifique se os nomes em AUTO_PICK_LEAGUES_CANONICAL batem com o que o provider devolve."
    );
    process.exit(0);
  }

  // ============================================================
  // 3. Para cada liga auto_pick: /teams?league=ID&season=N
  // ============================================================
  let teamsUpserted = 0;
  let leagueTeamsUpserted = 0;
  let teamsSkipped = 0;
  let stopped = false;

  for (const l of autoLeagues) {
    if (stopped) break;
    const q = await getQuotaSummary().catch(() => null);
    if (q && q.remaining <= QUOTA_FLOOR) {
      console.warn(
        `\n⚠ Quota cruzou floor (${q.remaining} ≤ ${QUOTA_FLOOR}). Parando antes de league ${l.name}.`
      );
      break;
    }

    try {
      console.log(`\n→ GET /teams?league=${l.api_league_id}&season=${args.season}  (${l.name} / ${l.country})`);
      const resp = await apiFootballGet<{ response: TeamBlock[] }>("/teams", {
        league: l.api_league_id,
        season: args.season,
      });
      const teamBlocks = resp.response ?? [];
      if (teamBlocks.length === 0) {
        teamsSkipped++;
        console.log(`   (sem teams retornados — pulando)`);
        continue;
      }

      const teamRows = teamBlocks.map((b) => ({
        api_team_id: b.team.id,
        name: b.team.name,
        code: b.team.code ?? null,
        country: b.team.country ?? null,
        founded: b.team.founded ?? null,
        national: !!b.team.national,
        logo_url: b.team.logo ?? null,
        raw_json: b as unknown as object,
      }));

      // Dedupe defensivo (caso provider devolva o mesmo id 2x).
      const seen = new Set<number>();
      const dedupedTeamRows = teamRows.filter((t) => {
        if (seen.has(t.api_team_id)) return false;
        seen.add(t.api_team_id);
        return true;
      });

      const { error: tErr } = await sb
        .from("football_teams_catalog")
        .upsert(dedupedTeamRows, { onConflict: "api_team_id" });
      if (tErr) {
        console.warn(`   ✗ upsert teams: ${tErr.message}`);
        continue;
      }
      teamsUpserted += dedupedTeamRows.length;
      console.log(`   ✓ upsert teams: ${dedupedTeamRows.length}`);

      // Ponte
      const ltRows = dedupedTeamRows.map((t) => ({
        api_league_id: l.api_league_id,
        api_team_id: t.api_team_id,
        season: args.season,
        country: l.country ?? null,
      }));
      const { error: ltErr } = await sb
        .from("football_league_teams")
        .upsert(ltRows, {
          onConflict: "api_league_id,api_team_id,season",
        });
      if (ltErr) {
        console.warn(`   ✗ upsert league_teams: ${ltErr.message}`);
        continue;
      }
      leagueTeamsUpserted += ltRows.length;
      console.log(`   ✓ upsert league_teams: ${ltRows.length}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isPlanLimitError(msg)) {
        console.error(`\n⛔ Plano grátis bloqueia. Parando.`);
        stopped = true;
        break;
      }
      console.warn(`   ✗ /teams league=${l.api_league_id}: ${msg.slice(0, 120)}`);
    }
  }

  const quotaAfter = await getQuotaSummary().catch(() => null);

  console.log("\n=== Resumo ===");
  console.log(`  leagues upsertadas:        ${upsertedLeagues}`);
  console.log(`  ligas marcadas auto_pick:  ${autoLeagues.length}`);
  console.log(`  teams upsertados:          ${teamsUpserted}`);
  console.log(`  league_teams upsertadas:   ${leagueTeamsUpserted}`);
  console.log(`  ligas sem teams (skip):    ${teamsSkipped}`);
  if (quotaBefore && quotaAfter) {
    console.log(
      `  quota: ${quotaBefore.realRequests}/${quotaBefore.limit} → ${quotaAfter.realRequests}/${quotaAfter.limit}`
    );
    console.log(
      `  reais consumidas: ${quotaAfter.realRequests - quotaBefore.realRequests}`
    );
  }

  console.log("\n→ Próximo passo sugerido:");
  console.log(
    `   npm run daily:auto-picks -- --date=<DATA> --dryRun=true  (agora filtra por catálogo)`
  );

  process.exit(0);
}

main().catch((err) => {
  console.error("\n✗ Erro fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
