import "@/lib/server-only-guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Helper compartilhado de processamento de fixture (Fase E.0A.12).
 *
 * Usado por:
 *   - scripts/run-fixture-analysis-worker.ts (CLI)
 *   - app/api/cron/fixture-analysis/route.ts (Vercel Cron)
 *   - app/api/studio/force-analyze/route.ts  (Studio button)
 *
 * Executa: lineup sync (se faltar) → last5 → board → readiness → pick.
 *
 * Não chama API em dryRun. Respeita quota_floor.
 *
 * Retorna um snapshot rico com diagnóstico de BLOCKED (lineup_count,
 * with_history, sample3_count, dq, strong_count, motivo).
 */

const FT_STATUSES = ["FT", "AET", "PEN"];
const SYNTHETIC_API_PLAYER_ID_MIN = 800_000_000;

export interface ProcessFixtureOptions {
  apiFixtureId: number;
  dryRun: boolean;
  /** Última coleta last5 — default 5 jogos por time. */
  last?: number;
  /** Atualiza fixture_analysis_schedule se for true (default true em CLI). */
  persistSchedule?: boolean;
}

export interface FixtureSnapshot {
  api_fixture_id: number;
  match_name: string | null;
  league_name: string | null;
  kickoff_at: string | null;
  lineup_count: number;
  players_resolved: number;       // api_player_id real (não sintético) com lineup
  players_with_history: number;   // resolvidos + sample > 0
  sample3_count: number;          // probs com sample >= 3
  dq_avg: number;
  strong_count: number;           // probs com recommendation='forte'
  readiness: "READY" | "WATCHLIST" | "BLOCKED" | "ERROR" | "UNKNOWN";
  readiness_reason: string;
  picks_drafted: number;
  reqs_used: number;
  warnings: string[];
  /** Por que ficou BLOCKED — string humana. */
  blocked_reason: string | null;
}

interface FixtureMeta {
  id: string;
  api_fixture_id: number;
  league_name: string | null;
  home_team_name: string | null;
  away_team_name: string | null;
  kickoff_at: string | null;
  api_home_team_id: number | null;
  api_away_team_id: number | null;
}

function isPlanLimitError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('"plan"') ||
    m.includes("free plan") ||
    m.includes("do not have access")
  );
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((res) => setTimeout(res, ms));
}

async function loadMeta(apiFixtureId: number): Promise<FixtureMeta | null> {
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from("football_fixtures")
    .select(
      "id, api_fixture_id, league_name, home_team_name, away_team_name, kickoff_at, api_home_team_id, api_away_team_id"
    )
    .eq("api_fixture_id", apiFixtureId)
    .maybeSingle();
  return (data as FixtureMeta) ?? null;
}

/**
 * Recolhe métricas crus do banco — sample3, dq, players_resolved, etc.
 * Útil para o diagnóstico de "por que ficou BLOCKED".
 */
async function loadSnapshot(meta: FixtureMeta): Promise<{
  lineup_count: number;
  players_resolved: number;
  sample3_count: number;
  dq_avg: number;
  strong_count: number;
}> {
  const sb = getSupabaseAdmin();
  const [{ data: lineupRows }, { data: probRows }] = await Promise.all([
    sb
      .from("football_lineup_players")
      .select("api_player_id")
      .eq("fixture_id", meta.id),
    sb
      .from("football_player_action_probabilities")
      .select("sample_size, data_quality_score, recommendation")
      .eq("api_fixture_id", meta.api_fixture_id),
  ]);

  const lineup = (lineupRows ?? []) as Array<{ api_player_id: number | null }>;
  const probs = (probRows ?? []) as Array<{
    sample_size: number | null;
    data_quality_score: number | null;
    recommendation: string | null;
  }>;

  const players_resolved = lineup.filter(
    (l) =>
      l.api_player_id != null &&
      l.api_player_id > 0 &&
      l.api_player_id < SYNTHETIC_API_PLAYER_ID_MIN
  ).length;

  const sample3_count = probs.filter((p) => (p.sample_size ?? 0) >= 3).length;
  const dqValues = probs
    .map((p) => Number(p.data_quality_score))
    .filter((n) => Number.isFinite(n) && n > 0);
  const dq_avg =
    dqValues.length > 0
      ? dqValues.reduce((a, b) => a + b, 0) / dqValues.length
      : 0;
  const strong_count = probs.filter((p) => p.recommendation === "forte").length;

  return {
    lineup_count: lineup.length,
    players_resolved,
    sample3_count,
    dq_avg: Number(dq_avg.toFixed(3)),
    strong_count,
  };
}

function explainBlocked(s: {
  lineup_count: number;
  players_with_history: number;
  sample3_count: number;
  dq_avg: number;
  strong_count: number;
}): string {
  if (s.lineup_count === 0) return "lineup 0/0 — sem escalação no banco";
  if (s.players_with_history === 0)
    return `${s.lineup_count} jogadores, mas 0 com histórico real`;
  if (s.sample3_count === 0)
    return `0 probs com sample ≥ 3 (rode collect:player-last5)`;
  if (s.dq_avg < 0.45)
    return `dq médio ${s.dq_avg.toFixed(2)} abaixo de 0.45`;
  if (s.strong_count === 0)
    return `sem ações 'forte' (todas em 'monitorar'/'evitar')`;
  return "critérios de readiness não atingidos";
}

// ============================================================
// Entrypoint
// ============================================================

export async function processOneFixture(
  opts: ProcessFixtureOptions
): Promise<FixtureSnapshot> {
  const { getActiveProvider } = await import("@/lib/football-data/provider");
  const { getQuotaSummary } = await import("@/lib/api-football/quota");
  const { syncFixturePlayerStats } = await import("@/lib/api-football/sync");
  const { runFixturePlayerIntel } = await import("@/lib/player-intel");
  const { evaluateFixtureReadinessForPick } = await import(
    "@/lib/player-intel/readiness-gate"
  );
  const {
    generateSoloPick,
    generateSafeMulti,
    generateValueMulti,
    generateGameWatchlist,
    saveGeneratedPick,
  } = await import("@/lib/player-intel/final-pick-generator");
  const { getApiQuotaFloor, getApiRequestDelayMs } = await import(
    "@/lib/api-football/config"
  );

  const sb = getSupabaseAdmin();
  const provider = getActiveProvider();
  const QUOTA_FLOOR = getApiQuotaFloor();
  const DELAY_MS = getApiRequestDelayMs();
  const last = opts.last ?? 5;
  const persistSchedule = opts.persistSchedule !== false;

  const meta = await loadMeta(opts.apiFixtureId);
  if (!meta) {
    return {
      api_fixture_id: opts.apiFixtureId,
      match_name: null,
      league_name: null,
      kickoff_at: null,
      lineup_count: 0,
      players_resolved: 0,
      players_with_history: 0,
      sample3_count: 0,
      dq_avg: 0,
      strong_count: 0,
      readiness: "ERROR",
      readiness_reason: "fixture não encontrado em football_fixtures",
      picks_drafted: 0,
      reqs_used: 0,
      warnings: [`fixture ${opts.apiFixtureId} não está no banco`],
      blocked_reason: "fixture inexistente",
    };
  }

  const matchName = `${meta.home_team_name ?? "?"} × ${meta.away_team_name ?? "?"}`;
  const result: FixtureSnapshot = {
    api_fixture_id: opts.apiFixtureId,
    match_name: matchName,
    league_name: meta.league_name,
    kickoff_at: meta.kickoff_at,
    lineup_count: 0,
    players_resolved: 0,
    players_with_history: 0,
    sample3_count: 0,
    dq_avg: 0,
    strong_count: 0,
    readiness: "UNKNOWN",
    readiness_reason: "",
    picks_drafted: 0,
    reqs_used: 0,
    warnings: [],
    blocked_reason: null,
  };

  // ============================================================
  // 1. Lineup sync (se necessário)
  // ============================================================
  const { count: existingLineup } = await sb
    .from("football_lineup_players")
    .select("*", { count: "exact", head: true })
    .eq("fixture_id", meta.id);
  const hasLineup = (existingLineup ?? 0) > 0;

  if (!hasLineup && !opts.dryRun) {
    const q = await getQuotaSummary().catch(() => null);
    if (q && q.remaining <= QUOTA_FLOOR) {
      result.warnings.push(`quota baixa, pulando lineup sync`);
    } else {
      try {
        const lu = await provider.syncFixtureLineups(opts.apiFixtureId);
        result.reqs_used += 1;
        if (persistSchedule) {
          await sb
            .from("fixture_analysis_schedule")
            .update({
              last_lineup_check_at: new Date().toISOString(),
              lineup_source: "api_predicted",
              players_total: lu.total_players,
              status: "lineup_confirmed",
            })
            .eq("api_fixture_id", opts.apiFixtureId);
        }
        await sleep(DELAY_MS);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.warnings.push(`lineup: ${msg.slice(0, 140)}`);
        if (isPlanLimitError(msg)) {
          // Plan-limit é fatal — marca BLOCKED e sai
          result.readiness = "BLOCKED";
          result.readiness_reason = `plano API bloqueou /fixtures/lineups`;
          result.blocked_reason = "API bloqueou lineup sync";
          return result;
        }
      }
    }
  }

  // ============================================================
  // 2. Last5 — para os 2 times do fixture
  // ============================================================
  if (!opts.dryRun) {
    for (const apiTeamId of [meta.api_home_team_id, meta.api_away_team_id]) {
      if (!apiTeamId || apiTeamId <= 0) continue;
      const q = await getQuotaSummary().catch(() => null);
      if (q && q.remaining <= QUOTA_FLOOR) {
        result.warnings.push(`quota baixa antes last5 team=${apiTeamId}`);
        break;
      }
      try {
        const reqs = await collectLast5(
          sb,
          syncFixturePlayerStats,
          opts.apiFixtureId,
          apiTeamId,
          meta.kickoff_at,
          last,
          QUOTA_FLOOR,
          getQuotaSummary,
          DELAY_MS,
          (w) => result.warnings.push(w)
        );
        result.reqs_used += reqs;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.warnings.push(`last5 team=${apiTeamId}: ${msg.slice(0, 120)}`);
        if (isPlanLimitError(msg)) break;
      }
    }
  }

  // ============================================================
  // 3. Board
  // ============================================================
  try {
    const board = await runFixturePlayerIntel(opts.apiFixtureId);
    if (persistSchedule && !opts.dryRun) {
      await sb
        .from("fixture_analysis_schedule")
        .update({
          last_board_generated_at: new Date().toISOString(),
          data_quality_score: board.data_quality_avg,
          players_resolved: board.players_analyzed,
          status: "board_ready",
        })
        .eq("api_fixture_id", opts.apiFixtureId);
    }
  } catch (err) {
    result.warnings.push(
      `board: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // ============================================================
  // 4. Snapshot
  // ============================================================
  const snap = await loadSnapshot(meta);
  result.lineup_count = snap.lineup_count;
  result.players_resolved = snap.players_resolved;
  result.sample3_count = snap.sample3_count;
  result.dq_avg = snap.dq_avg;
  result.strong_count = snap.strong_count;

  // ============================================================
  // 5. Readiness
  // ============================================================
  let gateLevel: "READY" | "WATCHLIST" | "BLOCKED" = "BLOCKED";
  let gateReason = "";
  let gateWithHistory = 0;
  try {
    const gate = await evaluateFixtureReadinessForPick(opts.apiFixtureId);
    gateLevel = gate.level;
    gateReason = gate.reason;
    gateWithHistory = gate.with_history;
    result.players_with_history = gate.with_history;
    result.readiness = gate.level;
    result.readiness_reason = gate.reason;
  } catch (err) {
    result.readiness = "ERROR";
    result.readiness_reason =
      err instanceof Error ? err.message : String(err);
    result.blocked_reason = result.readiness_reason;
    return result;
  }

  // Diagnóstico de BLOCKED para a UI/log
  if (gateLevel === "BLOCKED") {
    result.blocked_reason = explainBlocked({
      lineup_count: snap.lineup_count,
      players_with_history: result.players_with_history,
      sample3_count: snap.sample3_count,
      dq_avg: snap.dq_avg,
      strong_count: snap.strong_count,
    });
  }

  // ============================================================
  // 6. Picks (READY → solo+safe+value+watchlist; WATCHLIST → só watchlist)
  // ============================================================
  // Captura em const locais para o TS narrowing atravessar closures.
  const metaLeagueName = meta.league_name;
  const metaKickoffAt = meta.kickoff_at;
  const pickDate = (metaKickoffAt ?? new Date().toISOString()).slice(0, 10);
  const snapshot = {
    lineup_count: snap.lineup_count,
    players_resolved: snap.players_resolved,
    with_history: gateWithHistory,
    sample3_count: snap.sample3_count,
    dq_avg: snap.dq_avg,
    strong_count: snap.strong_count,
    readiness: gateLevel,
    reason: gateReason,
  };

  async function persist(
    gen: () => Promise<Awaited<ReturnType<typeof generateSoloPick>>>
  ): Promise<void> {
    const p = await gen();
    if (!p) return;
    if (opts.dryRun) {
      result.picks_drafted++;
      return;
    }
    try {
      const out = await saveGeneratedPick({
        pick: p,
        pick_date: pickDate,
        match_name: matchName,
        league_name: metaLeagueName,
        kickoff_at: metaKickoffAt,
        generation_stage: "final",
        readiness_snapshot: snapshot,
        status: "draft",
      });
      if (out.pick_id) result.picks_drafted++;
    } catch (err) {
      result.warnings.push(
        `pick ${p.risk}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (gateLevel === "READY") {
    await persist(() => generateSoloPick(opts.apiFixtureId));
    await persist(() => generateSafeMulti(opts.apiFixtureId));
    await persist(() => generateValueMulti(opts.apiFixtureId));
    await persist(() => generateGameWatchlist(opts.apiFixtureId));
  } else if (gateLevel === "WATCHLIST") {
    await persist(() => generateGameWatchlist(opts.apiFixtureId));
  }

  if (persistSchedule && !opts.dryRun) {
    const newStatus =
      gateLevel === "READY"
        ? "picks_draft_ready"
        : gateLevel === "WATCHLIST"
          ? "board_ready"
          : "blocked";
    await sb
      .from("fixture_analysis_schedule")
      .update({
        last_pick_generated_at: new Date().toISOString(),
        readiness_level: gateLevel,
        readiness_score: gateWithHistory,
        status: newStatus,
        error_message: result.blocked_reason,
      })
      .eq("api_fixture_id", opts.apiFixtureId);
  }

  return result;
}

// ============================================================
// Helper de last5 (idêntico ao do worker, isolado aqui)
// ============================================================

async function collectLast5(
  sb: ReturnType<typeof import("@/lib/supabase/admin").getSupabaseAdmin>,
  syncFixturePlayerStats: typeof import("@/lib/api-football/sync").syncFixturePlayerStats,
  targetApiFixtureId: number,
  apiTeamId: number,
  targetKickoff: string | null,
  last: number,
  quotaFloor: number,
  getQuotaSummary: typeof import("@/lib/api-football/quota").getQuotaSummary,
  delayMs: number,
  addWarning: (w: string) => void
): Promise<number> {
  let reqs = 0;
  const { data: localFx } = await sb
    .from("football_fixtures")
    .select("id, api_fixture_id, kickoff_at")
    .or(`api_home_team_id.eq.${apiTeamId},api_away_team_id.eq.${apiTeamId}`)
    .in("status", FT_STATUSES)
    .lt("kickoff_at", targetKickoff ?? new Date().toISOString())
    .neq("api_fixture_id", targetApiFixtureId)
    .order("kickoff_at", { ascending: false })
    .limit(last);
  const localList = (localFx ?? []) as Array<{ id: string; api_fixture_id: number }>;

  if (localList.length < last) {
    try {
      const { apiFootballGet } = await import("@/lib/api-football/client");
      type Block = {
        fixture: { id: number; date: string; status?: { short?: string } };
        league: { id: number; name: string; season?: number };
        teams: { home: { id: number; name: string }; away: { id: number; name: string } };
      };
      const body = await apiFootballGet<{ response: Block[] }>("/fixtures", {
        team: apiTeamId,
        last: last + 5,
      });
      reqs += 1;
      const eligible = (body.response ?? []).filter(
        (b) =>
          b.fixture.id !== targetApiFixtureId &&
          b.fixture.date < (targetKickoff ?? "") &&
          FT_STATUSES.includes(b.fixture.status?.short ?? "")
      );
      if (eligible.length > 0) {
        await sb.from("football_fixtures").upsert(
          eligible.map((b) => ({
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
          })),
          { onConflict: "api_fixture_id" }
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addWarning(`/fixtures?team=${apiTeamId}: ${msg.slice(0, 100)}`);
      if (isPlanLimitError(msg)) throw err;
    }
  }

  const { data: refreshed } = await sb
    .from("football_fixtures")
    .select("id, api_fixture_id")
    .or(`api_home_team_id.eq.${apiTeamId},api_away_team_id.eq.${apiTeamId}`)
    .in("status", FT_STATUSES)
    .lt("kickoff_at", targetKickoff ?? new Date().toISOString())
    .neq("api_fixture_id", targetApiFixtureId)
    .order("kickoff_at", { ascending: false })
    .limit(last);
  const all = (refreshed ?? []) as Array<{ id: string; api_fixture_id: number }>;
  const { data: covered } = await sb
    .from("football_player_match_stats")
    .select("fixture_id")
    .in("fixture_id", all.map((f) => f.id));
  const coveredSet = new Set((covered ?? []).map((r) => r.fixture_id as string));
  const toCollect = all.filter((f) => !coveredSet.has(f.id));

  for (const f of toCollect) {
    const q = await getQuotaSummary().catch(() => null);
    if (q && q.remaining <= quotaFloor) {
      addWarning(`quota baixa antes fx=${f.api_fixture_id}`);
      break;
    }
    try {
      await syncFixturePlayerStats(f.api_fixture_id);
      reqs += 1;
      await sleep(delayMs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addWarning(`stats ${f.api_fixture_id}: ${msg.slice(0, 100)}`);
      if (isPlanLimitError(msg)) throw err;
    }
  }
  return reqs;
}
