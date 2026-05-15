/**
 * Collect last5 — coleta os últimos N jogos dos JOGADORES do fixture
 * alvo (lineup completo: titulares + reservas), preenchendo
 * football_player_match_stats para que `runFixturePlayerIntel` tenha
 * sample > 0.
 *
 *   npm run collect:player-last5 -- --fixture=API_FIXTURE_ID --last=5 --dryRun=true
 *   npm run collect:player-last5 -- --fixture=API_FIXTURE_ID --last=5 --dryRun=false
 *
 * Diferença para `targeted-player-backfill`:
 *   - Aqui o foco é o LINEUP do fixture alvo. O relatório final mede
 *     sample por jogador desse lineup, não por time.
 *   - Mantém o mesmo motor de coleta (banco primeiro, API se gap),
 *     mesmo guard de quota, mesmo isPlanLimitError.
 *
 * Anti data-leakage:
 *   - Exclui o próprio fixture alvo.
 *   - Exclui qualquer fixture com kickoff_at >= kickoff do alvo.
 *   - Só aceita FT/AET/PEN.
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

const QUOTA_FLOOR = 30;
const FT_STATUSES = ["FT", "AET", "PEN"];

function parseArgs(): CliArgs {
  const argMap = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([a-zA-Z][a-zA-Z0-9-]*)(?:=(.+))?$/);
    if (m) argMap.set(m[1], m[2] ?? "true");
  }
  const fxRaw = argMap.get("fixture");
  if (!fxRaw) throw new Error("--fixture=API_FIXTURE_ID é obrigatório.");
  const apiFixtureId = Number(fxRaw);
  if (!Number.isFinite(apiFixtureId) || apiFixtureId <= 0) {
    throw new Error(`--fixture inválido: ${fxRaw}`);
  }
  const last = Number.parseInt(argMap.get("last") ?? "5", 10);
  if (!Number.isFinite(last) || last <= 0 || last > 10) {
    throw new Error(`--last inválido: ${argMap.get("last")}. Use 1..10.`);
  }
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

interface LineupPlayerInfo {
  api_player_id: number;
  player_name: string;
  team_id: string | null;
  api_team_id: number | null;
  is_starting: boolean;
  position: string | null;
}

async function main() {
  const args = parseArgs();
  console.log(
    `→ collect-target-fixture-player-last5 fixture=${args.apiFixtureId} last=${args.last} dryRun=${args.dryRun}\n`
  );

  const { getSupabaseAdmin } = await import("../lib/supabase/admin");
  const { getQuotaSummary } = await import("../lib/api-football/quota");
  const { syncFixturePlayerStats } = await import("../lib/api-football/sync");
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
  if (!target) {
    throw new Error(
      `Fixture ${args.apiFixtureId} não encontrado no banco. Rode syncFixturesByDate antes.`
    );
  }
  if (!target.api_home_team_id || !target.api_away_team_id) {
    throw new Error("Fixture alvo sem api_home_team_id/api_away_team_id.");
  }

  const targetFixtureId: string = target.id;
  const targetKickoff: string | null = target.kickoff_at;
  const targetApiHomeId: number = target.api_home_team_id;
  const targetApiAwayId: number = target.api_away_team_id;
  const targetHomeTeamId: string | null = target.home_team_id;
  const targetAwayTeamId: string | null = target.away_team_id;

  console.log(
    `→ Alvo: ${target.league_name} | ${target.home_team_name} × ${target.away_team_name} | kickoff=${targetKickoff}\n`
  );

  // 2. Lineups + lineup_players do fixture alvo
  const { data: lineupRowsRaw } = await sb
    .from("football_lineup_players")
    .select(
      "api_player_id, player_name, team_id, position, is_starting"
    )
    .eq("fixture_id", targetFixtureId);

  const lineupPlayers: LineupPlayerInfo[] = (lineupRowsRaw ?? [])
    .filter(
      (lp): lp is { api_player_id: number; player_name: string | null; team_id: string | null; position: string | null; is_starting: boolean | null } =>
        lp != null && typeof lp.api_player_id === "number" && lp.api_player_id > 0
    )
    .map((lp) => {
      const apiTeamId =
        lp.team_id === targetHomeTeamId
          ? targetApiHomeId
          : lp.team_id === targetAwayTeamId
            ? targetApiAwayId
            : null;
      return {
        api_player_id: lp.api_player_id,
        player_name: lp.player_name ?? "?",
        team_id: lp.team_id,
        api_team_id: apiTeamId,
        is_starting: !!lp.is_starting,
        position: lp.position ?? null,
      };
    });

  if (lineupPlayers.length === 0) {
    console.error(
      "✗ Sem lineup_players no banco para esse fixture. Rode syncFixtureLineups antes."
    );
    process.exit(2);
  }

  const startersCount = lineupPlayers.filter((p) => p.is_starting).length;
  const benchCount = lineupPlayers.length - startersCount;
  console.log(
    `→ Lineup do alvo: ${lineupPlayers.length} jogadores (${startersCount} titulares, ${benchCount} reservas)\n`
  );

  // ============================================================
  // Sample inicial dos jogadores do lineup (anti-leakage aplicado)
  // ============================================================
  async function computeLineupSample(): Promise<Map<number, number>> {
    const counts = new Map<number, number>();
    if (lineupPlayers.length === 0) return counts;

    // Conta sample em football_player_match_stats EXCLUINDO o fixture
    // alvo e fixtures posteriores ao kickoff do alvo.
    const apiIds = lineupPlayers.map((p) => p.api_player_id);
    const { data: stats } = await sb
      .from("football_player_match_stats")
      .select(
        "api_player_id, fixture_id, football_fixtures!inner(kickoff_at, status)"
      )
      .in("api_player_id", apiIds)
      .in("football_fixtures.status", FT_STATUSES)
      .neq("fixture_id", targetFixtureId);

    type Row = {
      api_player_id: number | null;
      football_fixtures: { kickoff_at?: string | null } | { kickoff_at?: string | null }[] | null;
    };
    for (const r of (stats ?? []) as Row[]) {
      const fxRel = r.football_fixtures;
      let ko: string | null = null;
      if (Array.isArray(fxRel)) ko = fxRel[0]?.kickoff_at ?? null;
      else if (fxRel) ko = fxRel.kickoff_at ?? null;
      if (targetKickoff && ko && ko >= targetKickoff) continue;
      const apiId = r.api_player_id;
      if (apiId == null || apiId <= 0) continue;
      counts.set(apiId, (counts.get(apiId) ?? 0) + 1);
    }
    return counts;
  }

  const sampleBefore = await computeLineupSample();
  function bucketize(counts: Map<number, number>): Record<string, number> {
    const buckets: Record<string, number> = { "0": 0, "1-2": 0, "3+": 0 };
    for (const p of lineupPlayers) {
      const n = counts.get(p.api_player_id) ?? 0;
      if (n === 0) buckets["0"]++;
      else if (n <= 2) buckets["1-2"]++;
      else buckets["3+"]++;
    }
    return buckets;
  }
  const bucketsBefore = bucketize(sampleBefore);
  console.log(`=== Sample atual (antes da coleta) ===`);
  console.log(
    `  bucket 0:    ${bucketsBefore["0"]}/${lineupPlayers.length}`
  );
  console.log(
    `  bucket 1-2:  ${bucketsBefore["1-2"]}/${lineupPlayers.length}`
  );
  console.log(
    `  bucket 3+:   ${bucketsBefore["3+"]}/${lineupPlayers.length}`
  );

  // ============================================================
  // 3. Últimos N fixtures locais por time (anti-leakage)
  // ============================================================
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

    // Quais já têm stats?
    const fixtureIds = rows.map((r) => r.id);
    const { data: covered } = await sb
      .from("football_player_match_stats")
      .select("fixture_id")
      .in("fixture_id", fixtureIds);
    const coveredSet = new Set(
      (covered ?? []).map((r) => r.fixture_id as string)
    );

    return rows.map((r) => ({
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
      api_team_id: targetApiHomeId,
      name: target.home_team_name ?? "?",
      role: "home" as const,
    },
    {
      api_team_id: targetApiAwayId,
      name: target.away_team_name ?? "?",
      role: "away" as const,
    },
  ];

  console.log(`\n=== Histórico LOCAL por time (últimos ${args.last}) ===`);
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
      console.log(`   (nada no banco — precisará da API)`);
    } else if (recent.length < args.last) {
      console.log(
        `   (faltam ${args.last - recent.length} no local — precisará da API)`
      );
    }
  }

  // 4. Plano e custo estimado
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
  console.log(
    `  fixtures locais únicos:           ${localFixtures.length}`
  );
  console.log(
    `    com stats já salvos:            ${localFixtures.length - needsStats.length}`
  );
  console.log(
    `    precisam syncFixturePlayerStats: ${needsStats.length}`
  );
  console.log(
    `  times com gap (< ${args.last} jogos local):          ${localGapByTeam.length}`
  );

  const quotaBefore = await getQuotaSummary();
  console.log(
    `\n→ Quota atual: ${quotaBefore.realRequests}/${quotaBefore.limit} reais, ${quotaBefore.cachedRequests} cacheadas, ${quotaBefore.remaining} restantes`
  );

  const estApiTeam = localGapByTeam.length;
  const estUpsertExtras = localGapByTeam.reduce((acc, t) => {
    const have = localByTeam.get(t.api_team_id)?.length ?? 0;
    return acc + Math.max(0, args.last - have);
  }, 0);
  const estPlayerStats = needsStats.length + estUpsertExtras;
  const estTotal = estApiTeam + estPlayerStats;

  console.log(`\n→ Custo estimado se rodar real:`);
  console.log(`   /fixtures?team=&last=N (1 por time c/ gap): ${estApiTeam}`);
  console.log(`   syncFixturePlayerStats nos faltantes:        ${estPlayerStats}`);
  console.log(`   total req real (pessimista):                 ${estTotal}`);

  if (args.dryRun) {
    console.log(`\n[dryRun] sem chamadas à API. Para coletar real:`);
    console.log(
      `   npm run collect:player-last5 -- --fixture=${args.apiFixtureId} --last=${args.last} --dryRun=false`
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

  // 1) Para cada time com gap, buscar /fixtures?team=&last= e upsert.
  let stoppedByPlanLimit = false;
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
          `\n⛔ Plano grátis bloqueia /fixtures?team=&last=. Parando.`
        );
        stoppedByPlanLimit = true;
        break;
      }
      console.warn(
        `   ✗ erro ao buscar /fixtures?team=${t.api_team_id}: ${msg.slice(0, 120)}`
      );
    }
  }

  // 2) Re-listar local consolidado.
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
    if (stoppedByPlanLimit) break;
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
        stoppedByPlanLimit = true;
        break;
      }
      errCount++;
      console.warn(`   ${f.api_fixture_id}  ✗ ${msg.slice(0, 120)}`);
    }
  }

  const quotaAfter = await getQuotaSummary();

  // ============================================================
  // 5. Sample DEPOIS + relatório por jogador
  // ============================================================
  const sampleAfter = await computeLineupSample();
  const bucketsAfter = bucketize(sampleAfter);

  console.log("\n=== Resumo da coleta ===");
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

  console.log("\n=== Sample dos jogadores do lineup ===");
  console.log("  bucket  antes / depois");
  console.log(
    `  0:      ${String(bucketsBefore["0"]).padStart(3)} / ${String(bucketsAfter["0"]).padStart(3)}`
  );
  console.log(
    `  1-2:    ${String(bucketsBefore["1-2"]).padStart(3)} / ${String(bucketsAfter["1-2"]).padStart(3)}`
  );
  console.log(
    `  3+:     ${String(bucketsBefore["3+"]).padStart(3)} / ${String(bucketsAfter["3+"]).padStart(3)}`
  );

  // Top jogadores com sample mais alto
  const ranked = lineupPlayers
    .map((p) => ({
      ...p,
      sample: sampleAfter.get(p.api_player_id) ?? 0,
    }))
    .sort((a, b) => b.sample - a.sample);

  console.log("\n=== Top 10 jogadores por sample ===");
  ranked.slice(0, 10).forEach((p, i) => {
    console.log(
      `  ${String(i + 1).padStart(2)}. ${p.player_name.padEnd(24)} sample=${p.sample}  pos=${p.position ?? "?"}  ${p.is_starting ? "(titular)" : "(reserva)"}`
    );
  });

  const stillZero = ranked.filter((p) => p.sample === 0);
  if (stillZero.length > 0) {
    console.log(
      `\n⚠ ${stillZero.length} jogadores ainda sem histórico após a coleta:`
    );
    stillZero
      .slice(0, 15)
      .forEach((p) =>
        console.log(
          `   - ${p.player_name.padEnd(24)} pos=${p.position ?? "?"}  ${p.is_starting ? "(titular)" : "(reserva)"}`
        )
      );
    if (stillZero.length > 15) {
      console.log(`   ... e mais ${stillZero.length - 15}`);
    }
  }

  console.log("\n→ Próximos passos sugeridos:");
  console.log(
    `   npm run test:player-action-board -- --fixture=${args.apiFixtureId}`
  );

  process.exit(errCount > 0 && okCount === 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\n✗ Erro fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
