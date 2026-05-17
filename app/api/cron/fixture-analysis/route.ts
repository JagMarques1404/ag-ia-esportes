import "@/lib/server-only-guard";
import { type NextRequest } from "next/server";
import { validateInternalApiAccess } from "@/lib/security/api-access";
import { okResponse, errorResponse } from "@/lib/api/response";

/**
 * Endpoint do worker temporal de análise de fixture (Fase E.0A.9).
 *
 * Configuração Vercel Cron sugerida (a cada 15 min):
 *
 *   {
 *     "crons": [{
 *       "path": "/api/cron/fixture-analysis",
 *       "schedule": "0,15,30,45 * * * *"
 *     }]
 *   }
 *
 * Autorização:
 *   - Authorization: Bearer ${CRON_SECRET}
 *   - x-cron-secret: ${CRON_SECRET}
 *   - OU sessão Supabase autenticada (admin)
 *
 * Comportamento: chama o worker em modo real (dryRun=false), processa
 * fixtures na janela, retorna resumo JSON.
 *
 * Importante:
 *   - Idempotente — pode ser invocado várias vezes na mesma janela.
 *   - Respeita QUOTA_FLOOR (lib/api-football/config).
 *   - Não bloqueia em plano-limit error — apenas pula para próximos.
 */

export const dynamic = "force-dynamic";
// Worker pode demorar: cada fixture até ~6 reqs com delay 250ms ≈ 1.5s.
// Para 10 fixtures simultâneos isso fica em torno de 15s. Vercel free
// limita route handler a 60s — mantemos abaixo disso com maxFixtures=10.
export const maxDuration = 60;

interface CronBody {
  /** Override now para teste. Default: now() do servidor. */
  now?: string;
  /** Cap de fixtures por execução. Default 10 (cabe em 60s). */
  maxFixtures?: number;
  /** Default false → grava de verdade. */
  dryRun?: boolean;
}

export async function POST(request: NextRequest) {
  const access = await validateInternalApiAccess(request);
  if (!access.ok) {
    return errorResponse(access.reason, {}, 401);
  }

  let body: CronBody = {};
  try {
    body = (await request.json()) as CronBody;
  } catch {
    // body opcional
  }
  const dryRun = body.dryRun === true;
  const maxFixtures = body.maxFixtures ?? 10;
  const now = body.now ? new Date(body.now) : new Date();
  if (!Number.isFinite(now.getTime())) {
    return errorResponse("now inválido (ISO 8601 esperado)", {}, 400);
  }

  try {
    const summary = await runWorker({ now, maxFixtures, dryRun });
    return okResponse(summary, {
      mode: access.mode,
      now: now.toISOString(),
      dryRun,
    });
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : "Erro desconhecido",
      {},
      500
    );
  }
}

// GET é alias do POST sem body — útil para Vercel Cron simples.
export async function GET(request: NextRequest) {
  return POST(request);
}

// ============================================================
// Worker inline (versão enxuta do scripts/run-fixture-analysis-worker.ts)
// ============================================================

interface WorkerOptions {
  now: Date;
  maxFixtures: number;
  dryRun: boolean;
}

interface ResultRow {
  api_fixture_id: number;
  match_name: string;
  phase: string;
  new_status: string;
  reqs_used: number;
  picks: number;
  warnings: string[];
}

type Phase =
  | "noop_far"
  | "precheck"
  | "second_pass"
  | "finalize_picks"
  | "kickoff_imminent"
  | "in_progress"
  | "stale";

function decidePhase(now: Date, kickoff: Date): Phase {
  const min = (kickoff.getTime() - now.getTime()) / 60_000;
  if (min > 120) return "noop_far";
  if (min > 60) return "precheck";
  if (min > 30) return "second_pass";
  if (min > 15) return "finalize_picks";
  if (min > -1) return "kickoff_imminent";
  if (min > -120) return "in_progress";
  return "stale";
}

function isPlanLimitError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('"plan"') ||
    m.includes("free plan") ||
    m.includes("do not have access")
  );
}

const FT_STATUSES = ["FT", "AET", "PEN"];

async function runWorker(opts: WorkerOptions): Promise<{
  processed: number;
  total_reqs: number;
  total_picks: number;
  total_warnings: number;
  results: ResultRow[];
}> {
  const { getSupabaseAdmin } = await import("@/lib/supabase/admin");
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

  const lowerIso = new Date(opts.now.getTime() - 2 * 60 * 60_000).toISOString();
  const upperIso = new Date(opts.now.getTime() + 24 * 60 * 60_000).toISOString();

  const { data: scheduled } = await sb
    .from("fixture_analysis_schedule")
    .select(
      "id, api_fixture_id, fixture_id, match_name, league_name, kickoff_at, status"
    )
    .gte("kickoff_at", lowerIso)
    .lt("kickoff_at", upperIso)
    .order("kickoff_at", { ascending: true })
    .limit(opts.maxFixtures);

  const results: ResultRow[] = [];
  for (const row of (scheduled ?? []) as Array<{
    id: string;
    api_fixture_id: number;
    fixture_id: string | null;
    match_name: string | null;
    league_name: string | null;
    kickoff_at: string | null;
    status: string;
  }>) {
    const r: ResultRow = {
      api_fixture_id: row.api_fixture_id,
      match_name: row.match_name ?? "?",
      phase: "stale",
      new_status: row.status,
      reqs_used: 0,
      picks: 0,
      warnings: [],
    };
    if (!row.kickoff_at) {
      results.push(r);
      continue;
    }
    const kickoff = new Date(row.kickoff_at);
    r.phase = decidePhase(opts.now, kickoff);

    if (
      r.phase === "noop_far" ||
      r.phase === "kickoff_imminent" ||
      r.phase === "in_progress" ||
      r.phase === "stale"
    ) {
      results.push(r);
      continue;
    }

    // precheck / second_pass: lineup → last5 → board
    if (r.phase === "precheck" || r.phase === "second_pass") {
      if (!opts.dryRun) {
        const q = await getQuotaSummary().catch(() => null);
        if (q && q.remaining > QUOTA_FLOOR) {
          try {
            const lu = await provider.syncFixtureLineups(row.api_fixture_id);
            r.reqs_used += 1;
            await sb
              .from("fixture_analysis_schedule")
              .update({
                last_lineup_check_at: new Date().toISOString(),
                lineup_source: "api_predicted",
                players_total: lu.total_players,
                status: "lineup_confirmed",
              })
              .eq("id", row.id);
            r.new_status = "lineup_confirmed";
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            r.warnings.push(`lineup: ${msg.slice(0, 120)}`);
            if (isPlanLimitError(msg)) continue;
          }

          // last5
          const { data: fxRow } = await sb
            .from("football_fixtures")
            .select("api_home_team_id, api_away_team_id, kickoff_at")
            .eq("id", row.fixture_id ?? "")
            .maybeSingle();
          for (const apiTeamId of [
            fxRow?.api_home_team_id,
            fxRow?.api_away_team_id,
          ] as Array<number | null | undefined>) {
            if (!apiTeamId || apiTeamId <= 0) continue;
            const qq = await getQuotaSummary().catch(() => null);
            if (qq && qq.remaining <= QUOTA_FLOOR) break;
            try {
              const reqs = await collectLast5InRoute(
                sb,
                syncFixturePlayerStats,
                row.api_fixture_id,
                apiTeamId,
                (fxRow?.kickoff_at as string | null) ?? row.kickoff_at,
                5,
                QUOTA_FLOOR,
                getQuotaSummary,
                DELAY_MS,
                (w) => r.warnings.push(w)
              );
              r.reqs_used += reqs;
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              r.warnings.push(`last5 ${apiTeamId}: ${msg.slice(0, 100)}`);
              if (isPlanLimitError(msg)) break;
            }
          }
        } else {
          r.warnings.push(`quota baixa antes do lineup sync`);
        }
      }
      try {
        const board = await runFixturePlayerIntel(row.api_fixture_id);
        if (!opts.dryRun) {
          await sb
            .from("fixture_analysis_schedule")
            .update({
              last_board_generated_at: new Date().toISOString(),
              data_quality_score: board.data_quality_avg,
              players_resolved: board.players_analyzed,
              status: "board_ready",
            })
            .eq("id", row.id);
        }
        r.new_status = "board_ready";
      } catch (err) {
        r.warnings.push(
          `board: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // finalize_picks
    if (r.phase === "finalize_picks") {
      try {
        const gate = await evaluateFixtureReadinessForPick(row.api_fixture_id);
        const snapshot = {
          readiness: gate.level,
          reason: gate.reason,
          with_history: gate.with_history,
          matched_no_history: gate.matched_no_history,
          synthetic: gate.synthetic,
          offensive_with_history: gate.offensive_with_history,
          avg_data_quality: gate.avg_data_quality,
        };
        const pickDate = (row.kickoff_at ?? opts.now.toISOString()).slice(0, 10);

        async function persist(p: Awaited<ReturnType<typeof generateSoloPick>>) {
          if (!p) return;
          if (opts.dryRun) {
            r.picks++;
            return;
          }
          try {
            const out = await saveGeneratedPick({
              pick: p,
              pick_date: pickDate,
              match_name: row.match_name ?? "?",
              league_name: row.league_name,
              kickoff_at: row.kickoff_at,
              generation_stage: "final",
              readiness_snapshot: snapshot,
              status: "draft",
            });
            if (out.pick_id) r.picks++;
          } catch (err) {
            r.warnings.push(
              `pick: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }

        if (gate.level === "READY") {
          await persist(await generateSoloPick(row.api_fixture_id));
          await persist(await generateSafeMulti(row.api_fixture_id));
          await persist(await generateValueMulti(row.api_fixture_id));
          await persist(await generateGameWatchlist(row.api_fixture_id));
        } else if (gate.level === "WATCHLIST") {
          await persist(await generateGameWatchlist(row.api_fixture_id));
        }

        const newStatus =
          gate.level === "READY"
            ? "picks_draft_ready"
            : gate.level === "WATCHLIST"
              ? "board_ready"
              : "blocked";
        if (!opts.dryRun) {
          await sb
            .from("fixture_analysis_schedule")
            .update({
              last_pick_generated_at: new Date().toISOString(),
              readiness_level: gate.level,
              readiness_score: gate.with_history,
              status: newStatus,
            })
            .eq("id", row.id);
        }
        r.new_status = newStatus;
      } catch (err) {
        r.warnings.push(
          `finalize: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    results.push(r);
  }

  return {
    processed: results.length,
    total_reqs: results.reduce((a, r) => a + r.reqs_used, 0),
    total_picks: results.reduce((a, r) => a + r.picks, 0),
    total_warnings: results.reduce((a, r) => a + r.warnings.length, 0),
    results,
  };
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((res) => setTimeout(res, ms));
}

async function collectLast5InRoute(
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
        teams: {
          home: { id: number; name: string };
          away: { id: number; name: string };
        };
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
