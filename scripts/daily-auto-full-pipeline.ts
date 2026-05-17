/**
 * Daily auto full pipeline — Fase E.0A.8.
 *
 * Orquestrador end-to-end: dado uma data, sincroniza fixtures, lineups,
 * coleta last5, gera boards, avalia readiness e publica drafts. Tudo
 * com flags e dryRun.
 *
 *   npm run daily:auto-full -- --date=YYYY-MM-DD --dryRun=true
 *   npm run daily:auto-full -- --date=YYYY-MM-DD --dryRun=false --maxFixtures=20
 *
 * Flags (defaults entre [..]):
 *   --syncFixtures=true|false       [true]
 *   --syncLineups=true|false        [true]
 *   --collectLast5=true|false       [true]
 *   --generateBoards=true|false     [true]
 *   --publishDrafts=true|false      [true]
 *   --requestDelayMs=N              [250]
 *   --maxFixtures=N                 [30]
 *   --last=N                        [5]  ← janela do last5 por time
 *
 * Reusa: getActiveProvider, syncFixturePlayerStats, runFixturePlayerIntel,
 * evaluateFixtureReadinessForPick, buildPicksFromBoard.
 */
process.env.AG_IA_SCRIPT_MODE = "true";

import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), ".env.local"), override: true });

interface CliArgs {
  date: string;
  dryRun: boolean;
  syncFixtures: boolean;
  syncLineups: boolean;
  collectLast5: boolean;
  generateBoards: boolean;
  publishDrafts: boolean;
  requestDelayMs: number;
  maxFixtures: number;
  last: number;
}

const FT_STATUSES = ["FT", "AET", "PEN"];

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
  const flag = (k: string, def: boolean) => {
    const v = argMap.get(k);
    if (v === undefined) return def;
    return v !== "false";
  };
  const dryRunRaw = argMap.get("dryRun");
  const dryRun = dryRunRaw === undefined ? true : dryRunRaw !== "false";
  return {
    date,
    dryRun,
    syncFixtures: flag("syncFixtures", true),
    syncLineups: flag("syncLineups", true),
    collectLast5: flag("collectLast5", true),
    generateBoards: flag("generateBoards", true),
    publishDrafts: flag("publishDrafts", true),
    requestDelayMs: Number.parseInt(argMap.get("requestDelayMs") ?? "250", 10),
    maxFixtures: Number.parseInt(argMap.get("maxFixtures") ?? "30", 10),
    last: Number.parseInt(argMap.get("last") ?? "5", 10),
  };
}

function isPlanLimitError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('"plan"') ||
    m.includes("free plan") ||
    m.includes("do not have access to this date")
  );
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((res) => setTimeout(res, ms));
}

// ============================================================
// Per-fixture state
// ============================================================

interface FixtureMeta {
  id: string;
  api_fixture_id: number;
  api_league_id: number | null;
  league_name: string | null;
  home_team_name: string | null;
  away_team_name: string | null;
  api_home_team_id: number | null;
  api_away_team_id: number | null;
  kickoff_at: string | null;
  date: string | null;
}

interface FixtureResult {
  api_fixture_id: number;
  league_name: string | null;
  match_name: string;
  kickoff_at: string | null;
  lineup_status: "OK" | "MISSING" | "FAILED";
  lineup_count: number;
  history_added: number;
  board_generated: boolean;
  readiness: "READY" | "WATCHLIST" | "BLOCKED" | "ERROR";
  readiness_reason: string;
  picks_drafted: number;
  reqs_used: number;
  warnings: string[];
}

async function main() {
  const args = parseArgs();
  console.log(
    `→ daily-auto-full date=${args.date} dryRun=${args.dryRun} max=${args.maxFixtures} last=${args.last}`
  );
  console.log(
    `   flags: syncFixtures=${args.syncFixtures} syncLineups=${args.syncLineups} collectLast5=${args.collectLast5} generateBoards=${args.generateBoards} publishDrafts=${args.publishDrafts}`
  );

  const { getSupabaseAdmin } = await import("../lib/supabase/admin");
  const { getActiveProvider } = await import("../lib/football-data/provider");
  const { getQuotaSummary } = await import("../lib/api-football/quota");
  const { syncFixturePlayerStats } = await import("../lib/api-football/sync");
  const { runFixturePlayerIntel } = await import("../lib/player-intel");
  const { evaluateFixtureReadinessForPick } = await import(
    "../lib/player-intel/readiness-gate"
  );
  const { buildPicksFromBoard, buildPicksPreview } = await import(
    "../lib/picks/build-from-board"
  );
  const { getApiQuotaFloor, getApiPlanName } = await import(
    "../lib/api-football/config"
  );
  const sb = getSupabaseAdmin();
  const provider = getActiveProvider();
  const QUOTA_FLOOR = getApiQuotaFloor();
  console.log(`→ plano=${getApiPlanName()} quota_floor=${QUOTA_FLOOR}\n`);

  const quotaStart = await getQuotaSummary().catch(() => null);
  if (quotaStart) {
    console.log(
      `→ quota inicial: ${quotaStart.realRequests}/${quotaStart.limit} reais, ${quotaStart.remaining} restantes`
    );
  }

  // ============================================================
  // 1. Sync fixtures da data (1 req)
  // ============================================================
  if (args.syncFixtures && !args.dryRun) {
    const q = await getQuotaSummary().catch(() => null);
    if (q && q.remaining <= QUOTA_FLOOR) {
      console.error(
        `\n✗ Quota baixa (${q.remaining} ≤ ${QUOTA_FLOOR}) — aborto.`
      );
      process.exit(2);
    }
    try {
      console.log(`\n→ syncFixturesByDate(${args.date})`);
      const r = await provider.syncFixturesByDate(args.date);
      console.log(`   ✓ ${r.total_fixtures} fixtures sincronizadas`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`   ⚠ syncFixturesByDate: ${msg.slice(0, 200)}`);
      if (isPlanLimitError(msg)) {
        console.error("⛔ Plano bloqueou /fixtures. Parando.");
        process.exit(2);
      }
    }
  } else {
    console.log(`\n→ [skip] syncFixtures (flag=${args.syncFixtures}, dryRun=${args.dryRun})`);
  }

  // ============================================================
  // 2. Listar fixtures alvo (date OR kickoff range BR + catálogo auto_pick)
  // ============================================================
  const dayStartBr = `${args.date}T03:00:00Z`;
  const nextDate = (() => {
    const d = new Date(`${args.date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().split("T")[0];
  })();
  const dayEndBr = `${nextDate}T03:00:00Z`;

  const { data: catalogIds } = await sb
    .from("football_leagues_catalog")
    .select("api_league_id")
    .eq("is_auto_pick", true);
  const autoPickLeagueIds = (catalogIds ?? [])
    .map((r) => Number(r.api_league_id))
    .filter((n) => Number.isFinite(n));

  function buildQ() {
    let q = sb
      .from("football_fixtures")
      .select(
        "id, api_fixture_id, api_league_id, league_name, home_team_name, away_team_name, api_home_team_id, api_away_team_id, kickoff_at, date"
      )
      .order("kickoff_at", { ascending: true, nullsFirst: false });
    if (autoPickLeagueIds.length > 0) {
      q = q.in("api_league_id", autoPickLeagueIds);
    }
    return q;
  }
  const [byDate, byKick] = await Promise.all([
    buildQ().eq("date", args.date),
    buildQ().gte("kickoff_at", dayStartBr).lt("kickoff_at", dayEndBr),
  ]);

  const merged = new Map<number, FixtureMeta>();
  for (const r of (byDate.data ?? []) as FixtureMeta[])
    merged.set(r.api_fixture_id, r);
  for (const r of (byKick.data ?? []) as FixtureMeta[])
    if (!merged.has(r.api_fixture_id)) merged.set(r.api_fixture_id, r);
  const fixtures = Array.from(merged.values())
    .sort((a, b) => (a.kickoff_at ?? "").localeCompare(b.kickoff_at ?? ""))
    .slice(0, args.maxFixtures);
  console.log(
    `\n→ ${fixtures.length} fixtures alvo (cap ${args.maxFixtures}) — date=${byDate.data?.length ?? 0}, kickoff=${byKick.data?.length ?? 0}, catálogo=${autoPickLeagueIds.length}`
  );

  if (fixtures.length === 0) {
    console.log("   (nenhum fixture na data — possivelmente rode syncFixtures=true ou catálogo vazio)");
    process.exit(0);
  }

  // ============================================================
  // 3. Para cada fixture: lineups → last5 → board → readiness → pick
  // ============================================================
  const results: FixtureResult[] = [];

  for (const fx of fixtures) {
    const matchName = `${fx.home_team_name ?? "?"} × ${fx.away_team_name ?? "?"}`;
    const result: FixtureResult = {
      api_fixture_id: fx.api_fixture_id,
      league_name: fx.league_name,
      match_name: matchName,
      kickoff_at: fx.kickoff_at,
      lineup_status: "MISSING",
      lineup_count: 0,
      history_added: 0,
      board_generated: false,
      readiness: "BLOCKED",
      readiness_reason: "",
      picks_drafted: 0,
      reqs_used: 0,
      warnings: [],
    };
    console.log(
      `\n→ ${fx.api_fixture_id}  ${fx.league_name ?? "?"}  ${matchName}  ${fx.kickoff_at ?? ""}`
    );

    // 3a. Lineup
    const { count: lineupCount } = await sb
      .from("football_lineup_players")
      .select("*", { count: "exact", head: true })
      .eq("fixture_id", fx.id);
    result.lineup_count = lineupCount ?? 0;
    if (result.lineup_count > 0) {
      result.lineup_status = "OK";
    } else if (args.syncLineups && !args.dryRun) {
      const q = await getQuotaSummary().catch(() => null);
      if (q && q.remaining <= QUOTA_FLOOR) {
        result.warnings.push(`quota baixa antes do lineup sync`);
        result.lineup_status = "MISSING";
      } else {
        try {
          const r = await provider.syncFixtureLineups(fx.api_fixture_id);
          result.reqs_used += 1;
          result.lineup_status = "OK";
          result.lineup_count = r.total_players;
          console.log(
            `   ✓ syncFixtureLineups: ${r.total_lineups} lineups, ${r.total_players} players`
          );
          await sleep(args.requestDelayMs);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.lineup_status = "FAILED";
          result.warnings.push(`lineup: ${msg.slice(0, 120)}`);
          if (isPlanLimitError(msg)) {
            console.error("   ⛔ Plano bloqueou /fixtures/lineups. Próximos fixtures vão pular lineup sync.");
          }
        }
      }
    } else {
      console.log(`   [skip] lineup sync — lineup_count=${result.lineup_count}`);
    }

    // Se lineup MISSING ou FAILED, não dá pra rodar pipeline — registra e pula
    if (result.lineup_status !== "OK" || result.lineup_count === 0) {
      result.readiness_reason = "sem lineup — pipeline pulado";
      results.push(result);
      continue;
    }

    // 3b. Last5 — coleta para os 2 times
    if (args.collectLast5 && !args.dryRun) {
      for (const apiTeamId of [fx.api_home_team_id, fx.api_away_team_id]) {
        if (apiTeamId == null || apiTeamId <= 0) continue;
        const q = await getQuotaSummary().catch(() => null);
        if (q && q.remaining <= QUOTA_FLOOR) {
          result.warnings.push(`quota baixa antes do last5 team=${apiTeamId}`);
          break;
        }
        try {
          await collectLast5ForTeam(
            sb,
            provider,
            syncFixturePlayerStats,
            fx,
            apiTeamId,
            args,
            QUOTA_FLOOR,
            getQuotaSummary,
            (r) => (result.reqs_used += r),
            (w) => result.warnings.push(w)
          );
          result.history_added++;
          await sleep(args.requestDelayMs);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.warnings.push(`last5 team=${apiTeamId}: ${msg.slice(0, 120)}`);
          if (isPlanLimitError(msg)) break;
        }
      }
    } else {
      console.log(`   [skip] collectLast5 (flag=${args.collectLast5}, dryRun=${args.dryRun})`);
    }

    // 3c. Board (sem API)
    if (args.generateBoards) {
      try {
        const r = await runFixturePlayerIntel(fx.api_fixture_id);
        result.board_generated = true;
        console.log(
          `   ✓ board: ${r.players_analyzed} players, ${r.probabilities_generated} probs, dq médio ${r.data_quality_avg}`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.warnings.push(`board: ${msg.slice(0, 120)}`);
      }
    }

    // 3d. Readiness gate
    try {
      const gate = await evaluateFixtureReadinessForPick(fx.api_fixture_id);
      result.readiness = gate.level;
      result.readiness_reason = gate.reason;
      console.log(`   gate: ${gate.level} — ${gate.reason}`);
    } catch (err) {
      result.readiness = "ERROR";
      result.readiness_reason =
        err instanceof Error ? err.message : String(err);
    }

    // 3e. Pick (apenas se READY)
    if (
      args.publishDrafts &&
      result.readiness === "READY" &&
      result.board_generated
    ) {
      const pickInput = {
        api_fixture_id: fx.api_fixture_id,
        pick_date: args.date,
        league_name: fx.league_name,
        match_name: matchName,
        kickoff_at: fx.kickoff_at,
        status: "draft" as const,
      };
      try {
        const out = args.dryRun
          ? await buildPicksPreview(pickInput)
          : await buildPicksFromBoard(pickInput);
        result.picks_drafted =
          (out.safe_pick_id ? 1 : 0) +
          (out.value_pick_id ? 1 : 0) +
          (args.dryRun
            ? (out.safe_legs.length >= 2 ? 1 : 0) +
              (out.value_legs.length >= 3 ? 1 : 0)
            : 0);
        console.log(
          `   ✓ picks: safe=${out.safe_legs.length} value=${out.value_legs.length} watch=${out.watchlist_legs.length}${args.dryRun ? " [dryRun]" : ` (gravadas=${(out.safe_pick_id ? 1 : 0) + (out.value_pick_id ? 1 : 0)})`}`
        );
      } catch (err) {
        result.warnings.push(
          `pick: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    results.push(result);
  }

  // ============================================================
  // 4. Relatório final em tabela
  // ============================================================
  const quotaEnd = await getQuotaSummary().catch(() => null);

  console.log("\n=========================================================================");
  console.log(" RELATÓRIO FINAL");
  console.log("=========================================================================");
  console.log(
    "fixture | liga | jogo | horário | lineup | sample | readiness | picks_draft"
  );
  console.log(
    "------------------------------------------------------------------------"
  );
  for (const r of results) {
    const time = r.kickoff_at?.slice(11, 16) ?? "?";
    const sample = `${r.lineup_count}p +${r.history_added}t`;
    console.log(
      [
        String(r.api_fixture_id).padStart(8),
        (r.league_name ?? "?").slice(0, 18).padEnd(18),
        r.match_name.slice(0, 32).padEnd(32),
        time,
        r.lineup_status.padEnd(8),
        sample.padEnd(10),
        r.readiness.padEnd(10),
        String(r.picks_drafted),
      ].join(" | ")
    );
  }
  console.log("\n=== Agregado ===");
  const byReadiness = results.reduce<Record<string, number>>((a, r) => {
    a[r.readiness] = (a[r.readiness] ?? 0) + 1;
    return a;
  }, {});
  for (const [k, v] of Object.entries(byReadiness)) {
    console.log(`  ${k.padEnd(12)} ${v}`);
  }
  const totalPicks = results.reduce((a, r) => a + r.picks_drafted, 0);
  console.log(`  picks (draft): ${totalPicks}`);
  const totalReqs = results.reduce((a, r) => a + r.reqs_used, 0);
  if (quotaStart && quotaEnd) {
    console.log(
      `  quota: ${quotaStart.realRequests} → ${quotaEnd.realRequests} (consumidas: ${quotaEnd.realRequests - quotaStart.realRequests}, soma local ${totalReqs})`
    );
  }
  const totalWarnings = results.reduce((a, r) => a + r.warnings.length, 0);
  if (totalWarnings > 0) {
    console.log(`  warnings: ${totalWarnings}`);
    for (const r of results) {
      if (r.warnings.length === 0) continue;
      console.log(`    ${r.api_fixture_id}:`);
      for (const w of r.warnings.slice(0, 3)) console.log(`      - ${w}`);
    }
  }

  if (args.dryRun) {
    console.log("\n[dryRun] sem writes em public_picks. Para publicar:");
    console.log(
      `   npm run daily:auto-full -- --date=${args.date} --dryRun=false --maxFixtures=${args.maxFixtures}`
    );
  }

  process.exit(0);
}

// ============================================================
// Helper: coleta last5 para um time específico
// ============================================================

async function collectLast5ForTeam(
  sb: ReturnType<typeof import("../lib/supabase/admin").getSupabaseAdmin>,
  provider: import("../lib/football-data/provider").FootballDataProvider,
  syncFixturePlayerStats: typeof import("../lib/api-football/sync").syncFixturePlayerStats,
  targetFixture: FixtureMeta,
  apiTeamId: number,
  args: CliArgs,
  quotaFloor: number,
  getQuotaSummary: typeof import("../lib/api-football/quota").getQuotaSummary,
  addReqs: (n: number) => void,
  addWarning: (w: string) => void
): Promise<void> {
  // 1. Já tem fixtures locais suficientes?
  const { data: localFx } = await sb
    .from("football_fixtures")
    .select("id, api_fixture_id, kickoff_at")
    .or(
      `api_home_team_id.eq.${apiTeamId},api_away_team_id.eq.${apiTeamId}`
    )
    .in("status", FT_STATUSES)
    .lt("kickoff_at", targetFixture.kickoff_at ?? new Date().toISOString())
    .neq("api_fixture_id", targetFixture.api_fixture_id)
    .order("kickoff_at", { ascending: false })
    .limit(args.last);
  const localIds = (localFx ?? []).map((f) => f.id as string);

  if (localIds.length < args.last) {
    // 2. Busca via API /fixtures?team=&last
    try {
      const { apiFootballGet } = await import("../lib/api-football/client");
      type Block = {
        fixture: { id: number; date: string; status?: { short?: string } };
        league: { id: number; name: string; country?: string; season?: number };
        teams: {
          home: { id: number; name: string };
          away: { id: number; name: string };
        };
      };
      const body = await apiFootballGet<{ response: Block[] }>("/fixtures", {
        team: apiTeamId,
        last: args.last + 5,
      });
      addReqs(1);
      const eligible = (body.response ?? []).filter(
        (b) =>
          b.fixture.id !== targetFixture.api_fixture_id &&
          b.fixture.date < (targetFixture.kickoff_at ?? "") &&
          FT_STATUSES.includes(b.fixture.status?.short ?? "")
      );
      // Upsert minimal — só os fixtures (league/teams já existem se sync rodou)
      const fixtureRows = eligible.map((b) => ({
        api_fixture_id: b.fixture.id,
        date: b.fixture.date.split("T")[0],
        kickoff_at: b.fixture.date,
        season: b.league.season ?? null,
        status: b.fixture.status?.short ?? "FT",
        league_name: b.league.name,
        api_league_id: b.league.id,
        api_home_team_id: b.teams.home.id,
        api_away_team_id: b.teams.away.id,
        home_team_name: b.teams.home.name,
        away_team_name: b.teams.away.name,
      }));
      if (fixtureRows.length > 0) {
        const { error: fxErr } = await sb
          .from("football_fixtures")
          .upsert(fixtureRows, { onConflict: "api_fixture_id" });
        if (fxErr) addWarning(`upsert fixtures team=${apiTeamId}: ${fxErr.message}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addWarning(`/fixtures?team=${apiTeamId}: ${msg.slice(0, 120)}`);
      if (msg.toLowerCase().includes("plan") || msg.toLowerCase().includes("free")) {
        throw err;
      }
    }
    void provider; // referenciado pra evitar unused
  }

  // 3. Re-buscar fixtures locais
  const { data: refreshedFx } = await sb
    .from("football_fixtures")
    .select("id, api_fixture_id, kickoff_at")
    .or(
      `api_home_team_id.eq.${apiTeamId},api_away_team_id.eq.${apiTeamId}`
    )
    .in("status", FT_STATUSES)
    .lt("kickoff_at", targetFixture.kickoff_at ?? new Date().toISOString())
    .neq("api_fixture_id", targetFixture.api_fixture_id)
    .order("kickoff_at", { ascending: false })
    .limit(args.last);
  const finalLocal = (refreshedFx ?? []) as Array<{
    id: string;
    api_fixture_id: number;
  }>;

  // 4. Verificar quais ainda precisam de player_stats
  const { data: covered } = await sb
    .from("football_player_match_stats")
    .select("fixture_id")
    .in(
      "fixture_id",
      finalLocal.map((f) => f.id)
    );
  const coveredSet = new Set((covered ?? []).map((r) => r.fixture_id as string));
  const toCollect = finalLocal.filter((f) => !coveredSet.has(f.id));

  // 5. syncFixturePlayerStats em cada faltante
  for (const f of toCollect) {
    const q = await getQuotaSummary().catch(() => null);
    if (q && q.remaining <= quotaFloor) {
      addWarning(`quota baixa antes de stats fixture=${f.api_fixture_id}`);
      break;
    }
    try {
      await syncFixturePlayerStats(f.api_fixture_id);
      addReqs(1);
      await sleep(args.requestDelayMs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addWarning(`stats ${f.api_fixture_id}: ${msg.slice(0, 120)}`);
      if (msg.toLowerCase().includes("plan") || msg.toLowerCase().includes("free")) {
        throw err;
      }
    }
  }
}

main().catch((err) => {
  console.error("\n✗ Erro fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
