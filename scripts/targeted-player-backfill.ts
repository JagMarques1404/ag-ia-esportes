/**
 * Targeted Player Backfill — coleta histórico individual dos dois
 * times de um fixture específico para que `runFixturePlayerIntel`
 * tenha sample > 0 nele.
 *
 *   npm run backfill:player-target -- --fixture=1537008 --last=3 --dryRun=true
 *   npm run backfill:player-target -- --fixture=1537008 --last=3 --dryRun=false
 *
 * Estratégia:
 *  1. Lê o fixture alvo + os dois times do banco.
 *  2. Para cada time, lista os últimos N jogos finalizados anteriores
 *     ao kickoff do alvo, **excluindo o próprio fixture alvo**.
 *  3. Se o banco local não tiver N suficientes:
 *      - dryRun=true: só reporta o gap.
 *      - dryRun=false: chama /fixtures?team=&last=N+5 para preencher
 *        e faz upsert mínimo (league + teams + fixture) inline.
 *  4. Para cada fixture obtido, dispara syncFixturePlayerStats só nos
 *     que ainda não têm registros em football_player_match_stats.
 *  5. Para automaticamente se quota.remaining ≤ 30 ou se algum erro
 *     de plano-limit aparecer.
 */
process.env.AG_IA_SCRIPT_MODE = "true";

import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), ".env.local"), override: true });

interface CliArgs {
  apiFixtureId: number;
  last: number;
  dryRun: boolean;
}

// QUOTA_FLOOR vem de env (API_FOOTBALL_QUOTA_FLOOR, default Pro = 500).
let QUOTA_FLOOR = 500;
const FT_STATUSES = ["FT", "AET", "PEN"];

function parseArgs(): CliArgs {
  const argMap = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([a-zA-Z][a-zA-Z0-9-]*)(?:=(.+))?$/);
    if (m) argMap.set(m[1], m[2] ?? "true");
  }
  const fxRaw = argMap.get("fixture");
  if (!fxRaw)
    throw new Error("--fixture=API_FIXTURE_ID é obrigatório.");
  const apiFixtureId = Number(fxRaw);
  if (!Number.isFinite(apiFixtureId) || apiFixtureId <= 0) {
    throw new Error(`--fixture inválido: ${fxRaw}`);
  }
  const last = Number.parseInt(argMap.get("last") ?? "3", 10);
  if (!Number.isFinite(last) || last <= 0 || last > 10) {
    throw new Error(`--last inválido: ${argMap.get("last")}. Use 1..10.`);
  }
  // Default dryRun=true. Real só com --dryRun=false explícito.
  const dryRunRaw = argMap.get("dryRun");
  const dryRun = dryRunRaw === undefined ? true : dryRunRaw !== "false";
  return { apiFixtureId, last, dryRun };
}

function isPlanLimitError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('"plan"') ||
    m.includes("free plan") ||
    m.includes("do not have access to this date")
  );
}

interface TeamRecentFixture {
  source: "local";
  api_fixture_id: number;
  fixture_id: string;
  kickoff_at: string | null;
  date: string | null;
  status: string | null;
  league_name: string | null;
  home_name: string | null;
  away_name: string | null;
  has_player_stats: boolean;
}

async function main() {
  const args = parseArgs();
  console.log(
    `→ targeted-player-backfill fixture=${args.apiFixtureId} last=${args.last} dryRun=${args.dryRun}\n`
  );

  const { getSupabaseAdmin } = await import("../lib/supabase/admin");
  const { getQuotaSummary } = await import("../lib/api-football/quota");
  const { syncFixturePlayerStats } = await import(
    "../lib/api-football/sync"
  );
  const { getApiQuotaFloor, getApiPlanName } = await import(
    "../lib/api-football/config"
  );
  QUOTA_FLOOR = getApiQuotaFloor();
  console.log(`→ plano=${getApiPlanName()} quota_floor=${QUOTA_FLOOR}`);
  const sb = getSupabaseAdmin();

  // 1. Fixture alvo
  const { data: target, error: tErr } = await sb
    .from("football_fixtures")
    .select(
      "id, api_fixture_id, kickoff_at, date, league_name, home_team_id, away_team_id, api_home_team_id, api_away_team_id, home_team_name, away_team_name"
    )
    .eq("api_fixture_id", args.apiFixtureId)
    .maybeSingle();
  if (tErr) throw new Error(`fixture alvo: ${tErr.message}`);
  if (!target)
    throw new Error(
      `Fixture ${args.apiFixtureId} não encontrado no banco. Rode syncFixturesByDate(date) antes.`
    );
  if (!target.api_home_team_id || !target.api_away_team_id) {
    throw new Error("Fixture alvo sem api_home_team_id/api_away_team_id.");
  }

  // Captura em const locais para preservar narrowing nas closures.
  const targetKickoff: string | null = target.kickoff_at;
  const targetApiHomeId: number = target.api_home_team_id;
  const targetApiAwayId: number = target.api_away_team_id;
  const targetHomeName: string | null = target.home_team_name;
  const targetAwayName: string | null = target.away_team_name;

  console.log(
    `→ Alvo: ${target.league_name} | ${targetHomeName} × ${targetAwayName} | kickoff=${targetKickoff}\n`
  );

  // 2. Últimos N jogos LOCAIS de cada time
  async function getLocalRecent(
    apiTeamId: number,
    teamName: string
  ): Promise<TeamRecentFixture[]> {
    const { data, error } = await sb
      .from("football_fixtures")
      .select(
        "id, api_fixture_id, kickoff_at, date, status, league_name, home_team_name, away_team_name"
      )
      .or(
        `api_home_team_id.eq.${apiTeamId},api_away_team_id.eq.${apiTeamId}`
      )
      .in("status", FT_STATUSES)
      .lt("kickoff_at", targetKickoff ?? new Date().toISOString())
      .neq("api_fixture_id", args.apiFixtureId)
      .order("kickoff_at", { ascending: false })
      .limit(args.last);
    void teamName;
    if (error) throw new Error(`local recent (${teamName}): ${error.message}`);

    const rows = (data ?? []) as Array<{
      id: string;
      api_fixture_id: number;
      kickoff_at: string | null;
      date: string | null;
      status: string | null;
      league_name: string | null;
      home_team_name: string | null;
      away_team_name: string | null;
    }>;
    if (rows.length === 0) return [];

    // Conferir quais já têm stats
    const fixtureIds = rows.map((r) => r.id);
    const { data: covered } = await sb
      .from("football_player_match_stats")
      .select("fixture_id")
      .in("fixture_id", fixtureIds);
    const coveredSet = new Set(
      (covered ?? []).map((r) => r.fixture_id as string)
    );

    return rows.map((r) => ({
      source: "local",
      api_fixture_id: r.api_fixture_id,
      fixture_id: r.id,
      kickoff_at: r.kickoff_at,
      date: r.date,
      status: r.status,
      league_name: r.league_name,
      home_name: r.home_team_name,
      away_name: r.away_team_name,
      has_player_stats: coveredSet.has(r.id),
    }));
  }

  const teams = [
    {
      api_team_id: target.api_home_team_id,
      name: target.home_team_name ?? "?",
      role: "home" as const,
    },
    {
      api_team_id: target.api_away_team_id,
      name: target.away_team_name ?? "?",
      role: "away" as const,
    },
  ];

  console.log(`=== Histórico LOCAL por time (últimos ${args.last}) ===`);
  const localByTeam = new Map<number, TeamRecentFixture[]>();
  for (const t of teams) {
    const recent = await getLocalRecent(t.api_team_id, t.name);
    localByTeam.set(t.api_team_id, recent);
    console.log(
      `\n→ ${t.name} (api=${t.api_team_id})  encontrado=${recent.length}/${args.last}`
    );
    for (const f of recent) {
      const tag = f.has_player_stats ? "[stats ok]" : "[falta stats]";
      console.log(
        `   ${f.api_fixture_id}  ${f.kickoff_at}  ${f.league_name}  ${f.home_name} × ${f.away_name}  ${tag}`
      );
    }
    if (recent.length === 0) {
      console.log(`   (nada no banco — precisará da API se quiser preencher)`);
    } else if (recent.length < args.last) {
      console.log(
        `   (faltam ${args.last - recent.length} no local — precisará da API)`
      );
    }
  }

  // 3. Análise de gaps
  const allLocal = teams.flatMap((t) => localByTeam.get(t.api_team_id) ?? []);
  const uniqueByApiId = new Map<number, TeamRecentFixture>();
  for (const f of allLocal) uniqueByApiId.set(f.api_fixture_id, f);
  const localFixtures = Array.from(uniqueByApiId.values());
  const needsStats = localFixtures.filter((f) => !f.has_player_stats);
  const localGapByTeam = teams.filter((t) => {
    const have = localByTeam.get(t.api_team_id)?.length ?? 0;
    return have < args.last;
  });

  console.log(`\n=== Plano ===`);
  console.log(`  fixtures locais únicos:           ${localFixtures.length}`);
  console.log(`    com stats já salvos:            ${localFixtures.length - needsStats.length}`);
  console.log(`    precisam syncFixturePlayerStats: ${needsStats.length}`);
  console.log(`  times com gap (< ${args.last} jogos local):          ${localGapByTeam.length}`);

  const quotaBefore = await getQuotaSummary();
  console.log(
    `\n→ Quota atual: ${quotaBefore.realRequests}/${quotaBefore.limit} reais, ${quotaBefore.cachedRequests} cacheadas, ${quotaBefore.remaining} restantes`
  );

  // Custo estimado
  const estApiTeam = localGapByTeam.length;        // 1 req /fixtures?team=&last
  const estUpsertExtras = localGapByTeam.reduce((acc, t) => {
    const have = localByTeam.get(t.api_team_id)?.length ?? 0;
    return acc + Math.max(0, args.last - have);
  }, 0);                                           // estimativa pessimista para fixtures novos a syncar stats
  const estPlayerStats = needsStats.length + estUpsertExtras;
  const estTotal = estApiTeam + estPlayerStats;

  console.log(`\n→ Custo estimado se rodar real:`);
  console.log(`   /fixtures?team=&last=N (1 por time c/ gap): ${estApiTeam}`);
  console.log(`   syncFixturePlayerStats nos faltantes:        ${estPlayerStats}`);
  console.log(`   total req real (pessimista):                 ${estTotal}`);

  if (args.dryRun) {
    console.log(`\n[dryRun] sem chamadas à API. Para coletar real:`);
    console.log(
      `   npm run backfill:player-target -- --fixture=${args.apiFixtureId} --last=${args.last} --dryRun=false`
    );
    process.exit(0);
  }

  if (quotaBefore.remaining <= QUOTA_FLOOR) {
    console.error(
      `\n✗ Aborto: quota baixa (remaining=${quotaBefore.remaining} ≤ ${QUOTA_FLOOR}).`
    );
    process.exit(2);
  }

  // ============================================================
  // EXECUÇÃO REAL
  // ============================================================
  const { apiFootballGet } = await import("../lib/api-football/client");
  const { normalizeLeagueFromFixture } = await import(
    "../lib/api-football/normalizers/leagues"
  );
  const { normalizeTeamFromFixture } = await import(
    "../lib/api-football/normalizers/teams"
  );
  const { normalizeFixture } = await import(
    "../lib/api-football/normalizers/fixtures"
  );

  type FixtureBlock = {
    fixture: {
      id: number;
      date: string;
      timestamp: number;
      timezone?: string;
      status?: { short?: string; long?: string; elapsed?: number | null };
      venue?: { id?: number | null; name?: string | null; city?: string | null };
      referee?: string | null;
    };
    league: {
      id: number;
      name: string;
      country?: string;
      logo?: string;
      season?: number;
      round?: string;
    };
    teams: { home: { id: number; name: string }; away: { id: number; name: string } };
    goals?: { home: number | null; away: number | null };
  };

  // 1) Para cada time com gap, chama /fixtures?team=&last= e faz upsert
  //    mínimo (league + teams + fixture) dos novos.
  for (const t of localGapByTeam) {
    const q = await getQuotaSummary();
    if (q.remaining <= QUOTA_FLOOR) {
      console.warn(
        `\n⚠ Quota cruzou o floor (${q.remaining} ≤ ${QUOTA_FLOOR}). Parando antes do team ${t.name}.`
      );
      break;
    }
    try {
      console.log(
        `\n→ /fixtures?team=${t.api_team_id}&last=${args.last + 5}  (${t.name})`
      );
      const body = await apiFootballGet<{
        response: FixtureBlock[];
      }>("/fixtures", { team: t.api_team_id, last: args.last + 5 });
      const eligible = (body.response ?? []).filter(
        (b) =>
          b.fixture.id !== args.apiFixtureId &&
          b.fixture.date < (targetKickoff ?? "") &&
          FT_STATUSES.includes(b.fixture.status?.short ?? "")
      );
      console.log(`   elegíveis (FT, anteriores ao alvo): ${eligible.length}`);

      // Upsert league + teams
      const leagueRows = Array.from(
        new Map(
          eligible.map((b) => [b.league.id, normalizeLeagueFromFixture(b.league)])
        ).values()
      );
      const teamRows = Array.from(
        new Map(
          eligible.flatMap((b) => [
            [b.teams.home.id, normalizeTeamFromFixture(b.teams.home)] as const,
            [b.teams.away.id, normalizeTeamFromFixture(b.teams.away)] as const,
          ])
        ).values()
      );
      if (leagueRows.length > 0) {
        await sb
          .from("football_leagues")
          .upsert(leagueRows, { onConflict: "api_league_id" });
      }
      if (teamRows.length > 0) {
        await sb
          .from("football_teams")
          .upsert(teamRows, { onConflict: "api_team_id" });
      }

      // Resolver IDs internos
      const { data: leaguesRes } = await sb
        .from("football_leagues")
        .select("id, api_league_id")
        .in("api_league_id", leagueRows.map((l) => l.api_league_id));
      const leagueIdByApi = new Map<number, string>();
      for (const l of leaguesRes ?? [])
        if (l.api_league_id != null)
          leagueIdByApi.set(l.api_league_id, l.id as string);

      const { data: teamsRes } = await sb
        .from("football_teams")
        .select("id, api_team_id")
        .in("api_team_id", teamRows.map((tr) => tr.api_team_id));
      const teamIdByApi = new Map<number, string>();
      for (const tr of teamsRes ?? [])
        if (tr.api_team_id != null)
          teamIdByApi.set(tr.api_team_id, tr.id as string);

      // Upsert fixtures
      const fixtureRows = eligible.map((b) =>
        normalizeFixture(
          b,
          leagueIdByApi.get(b.league.id) ?? null,
          teamIdByApi.get(b.teams.home.id) ?? null,
          teamIdByApi.get(b.teams.away.id) ?? null
        )
      );
      if (fixtureRows.length > 0) {
        const { error: fxErr } = await sb
          .from("football_fixtures")
          .upsert(fixtureRows, { onConflict: "api_fixture_id" });
        if (fxErr) console.warn(`   warn fixtures upsert: ${fxErr.message}`);
        else
          console.log(
            `   upsert fixtures: ${fixtureRows.length} (idempotente)`
          );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isPlanLimitError(msg)) {
        console.error(
          `\n⛔ Plano grátis bloqueia /fixtures?team=&last= ou similar. Parando.`
        );
        break;
      }
      console.warn(
        `   ✗ erro ao buscar /fixtures?team=${t.api_team_id}: ${msg.slice(0, 120)}`
      );
    }
  }

  // 2) Re-buscar local consolidado por time, agora com novos fixtures.
  const finalLocalByTeam = new Map<number, TeamRecentFixture[]>();
  for (const t of teams) {
    finalLocalByTeam.set(t.api_team_id, await getLocalRecent(t.api_team_id, t.name));
  }
  const finalLocal = Array.from(
    new Map(
      teams
        .flatMap((t) => finalLocalByTeam.get(t.api_team_id) ?? [])
        .map((f) => [f.api_fixture_id, f])
    ).values()
  );
  const toCollect = finalLocal.filter((f) => !f.has_player_stats);
  console.log(
    `\n→ Após upsert: ${finalLocal.length} fixtures locais, ${toCollect.length} sem stats.`
  );

  // 3) syncFixturePlayerStats nos faltantes
  let okCount = 0;
  let errCount = 0;
  let totalDupPlayers = 0;
  let totalDupStats = 0;
  let totalInvalid = 0;
  for (const f of toCollect) {
    const q = await getQuotaSummary();
    if (q.remaining <= QUOTA_FLOOR) {
      console.warn(
        `\n⚠ Quota cruzou o floor. Parando antes de fixture ${f.api_fixture_id}.`
      );
      break;
    }
    try {
      const r = await syncFixturePlayerStats(f.api_fixture_id);
      okCount++;
      totalDupPlayers += r.duplicate_players_dropped;
      totalDupStats += r.duplicate_stats_dropped;
      totalInvalid += r.invalid_players_skipped;
      console.log(
        `   ${f.api_fixture_id}  ✓ ${r.total_player_stats} stats  (dup ${r.duplicate_players_dropped}p/${r.duplicate_stats_dropped}s, invalid ${r.invalid_players_skipped})`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isPlanLimitError(msg)) {
        console.error(
          `\n⛔ Plano grátis bloqueia. Parando para preservar quota.`
        );
        break;
      }
      errCount++;
      console.warn(
        `   ${f.api_fixture_id}  ✗ ${msg.slice(0, 120)}`
      );
    }
  }

  const quotaAfter = await getQuotaSummary();
  console.log("\n=== Resumo ===");
  console.log(`  player_stats salvos em N fixtures: ${okCount}`);
  console.log(`  fixtures com erro:                 ${errCount}`);
  console.log(`  duplicates removidos:              ${totalDupPlayers}p / ${totalDupStats}s`);
  console.log(`  invalid api_id pulados:            ${totalInvalid}`);
  console.log(
    `  quota antes: ${quotaBefore.realRequests}/${quotaBefore.limit} (${quotaBefore.remaining} restantes)`
  );
  console.log(
    `  quota depois: ${quotaAfter.realRequests}/${quotaAfter.limit} (${quotaAfter.remaining} restantes)`
  );
  console.log(
    `  reais consumidas: ${quotaAfter.realRequests - quotaBefore.realRequests}`
  );

  console.log("\n→ Próximos passos sugeridos:");
  console.log(
    `   npm run readiness:player-intel -- --date=2026-05-15 --limit=10`
  );
  console.log(
    `   npm run test:player-intel -- --fixture=${args.apiFixtureId}`
  );

  process.exit(errCount > 0 && okCount === 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\n✗ Erro fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
