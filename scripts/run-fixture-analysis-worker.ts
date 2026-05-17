/**
 * Worker temporal de análise de fixture — Fase E.0A.9.
 *
 *   npm run worker:fixture-analysis -- --dryRun=true
 *   npm run worker:fixture-analysis -- --dryRun=false
 *   npm run worker:fixture-analysis -- --now=2026-05-17T12:00:00Z --dryRun=true
 *
 * Lê `fixture_analysis_schedule`, decide a fase baseada em (now − kickoff_at)
 * e executa o que precisa. Idempotente: pode rodar a cada 15 min.
 *
 * Janelas:
 *   T-24h+      : nada a fazer (status='scheduled')
 *   T-2h ... T-1h  : precheck — tentar lineup, se OK resolver + last5 + board preview
 *   T-1h ... T-30m : second pass — re-sync lineup, board final
 *   T-30m ... T-15m: gerar picks draft se READY; watchlist se WATCHLIST
 *   < T-15m até T+2h: deixa em paz (status fixo do último estado)
 *   T+2h+       : skip (já passou)
 *
 * Nunca chama API em dryRun. Respeita QUOTA_FLOOR.
 */
process.env.AG_IA_SCRIPT_MODE = "true";

import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), ".env.local"), override: true });

interface CliArgs {
  now: Date;
  dryRun: boolean;
  maxFixtures: number;
  /** Quando true, ignora janela de fase (T-2h..T-15m) e processa qualquer jogo. */
  forceAnalyze: boolean;
  /** Filtra fixtures cujo kickoff_at > now. */
  futureOnly: boolean;
  /** Filtra fixtures cujo kickoff_at >= "HH:mm" BR. */
  fromTime: string | null;
  /** Se set, processa só esse api_fixture_id. */
  fixture: number | null;
  /** Data alvo para o --fixture (se não existir no schedule, busca em football_fixtures). */
  date: string | null;
}

function parseArgs(): CliArgs {
  const argMap = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([a-zA-Z][a-zA-Z0-9-]*)(?:=(.+))?$/);
    if (m) argMap.set(m[1], m[2] ?? "true");
  }
  const nowRaw = argMap.get("now");
  const now = nowRaw ? new Date(nowRaw) : new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new Error(`--now inválido: ${nowRaw}`);
  }
  const dryRunRaw = argMap.get("dryRun");
  const dryRun = dryRunRaw === undefined ? true : dryRunRaw !== "false";
  const maxFixtures = Number.parseInt(argMap.get("maxFixtures") ?? "30", 10);
  const fixture = argMap.get("fixture")
    ? Number.parseInt(argMap.get("fixture")!, 10)
    : null;
  const fromTimeRaw = argMap.get("fromTime");
  const fromTime =
    fromTimeRaw && /^\d{2}:\d{2}$/.test(fromTimeRaw) ? fromTimeRaw : null;
  const dateRaw = argMap.get("date");
  const date = dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null;
  return {
    now,
    dryRun,
    maxFixtures: Number.isFinite(maxFixtures) ? maxFixtures : 30,
    forceAnalyze: argMap.get("forceAnalyze") === "true",
    futureOnly: argMap.get("futureOnly") === "true",
    fromTime,
    fixture: Number.isFinite(fixture as number) ? (fixture as number) : null,
    date,
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

const FT_STATUSES = ["FT", "AET", "PEN"];

type Phase =
  | "noop_far"          // > 2h antes
  | "precheck"          // T-2h .. T-1h
  | "second_pass"       // T-1h .. T-30m
  | "finalize_picks"    // T-30m .. T-15m
  | "kickoff_imminent"  // T-15m .. T+0
  | "in_progress"       // T+0 .. T+2h
  | "stale";            // > T+2h

function decidePhase(now: Date, kickoff: Date): Phase {
  const diffMs = kickoff.getTime() - now.getTime();
  const min = diffMs / 60_000;
  if (min > 120) return "noop_far";
  if (min > 60) return "precheck";
  if (min > 30) return "second_pass";
  if (min > 15) return "finalize_picks";
  if (min > -1) return "kickoff_imminent";
  if (min > -120) return "in_progress";
  return "stale";
}

interface ScheduleRow {
  id: string;
  api_fixture_id: number;
  fixture_id: string | null;
  match_name: string | null;
  league_name: string | null;
  kickoff_at: string | null;
  status: string;
  lineup_source: string | null;
  players_resolved: number | null;
  players_total: number | null;
  sample3_count: number | null;
  data_quality_score: number | null;
  readiness_level: string | null;
  readiness_score: number | null;
}

interface ResultRow {
  api_fixture_id: number;
  match_name: string;
  phase: Phase;
  action_taken: string;
  reqs_used: number;
  new_status: string;
  readiness?: string;
  picks?: number;
  warnings: string[];
}

// ============================================================
// Branch FORCE-ANALYZE: usa processOneFixture (lib/player-intel/
// fixture-processor) que ignora janela temporal.
// ============================================================

async function runForceAnalyze(
  args: CliArgs,
  sb: ReturnType<typeof import("../lib/supabase/admin").getSupabaseAdmin>
): Promise<void> {
  const { processOneFixture } = await import(
    "../lib/player-intel/fixture-processor"
  );

  // Coleta lista de api_fixture_ids alvo
  let targetIds: number[] = [];
  if (args.fixture != null) {
    targetIds = [args.fixture];
  } else {
    // Filtra fixtures futuros (ou >= fromTime BR no dia)
    const now = args.now;
    const date = args.date ?? now.toISOString().slice(0, 10);
    const dayStart = `${date}T03:00:00Z`;
    const dnext = (() => {
      const d = new Date(`${date}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().split("T")[0];
    })();
    const dayEnd = `${dnext}T03:00:00Z`;

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
        .select("api_fixture_id, kickoff_at, date")
        .order("kickoff_at", { ascending: true, nullsFirst: false });
      if (autoPickIds.length > 0) q = q.in("api_league_id", autoPickIds);
      return q;
    }
    const [byDate, byKick] = await Promise.all([
      buildQ().eq("date", date),
      buildQ().gte("kickoff_at", dayStart).lt("kickoff_at", dayEnd),
    ]);
    const merged = new Map<number, { api_fixture_id: number; kickoff_at: string | null }>();
    for (const r of (byDate.data ?? []) as Array<{
      api_fixture_id: number;
      kickoff_at: string | null;
    }>)
      merged.set(r.api_fixture_id, r);
    for (const r of (byKick.data ?? []) as Array<{
      api_fixture_id: number;
      kickoff_at: string | null;
    }>)
      if (!merged.has(r.api_fixture_id)) merged.set(r.api_fixture_id, r);

    let fixtures = Array.from(merged.values());
    // Filtro temporal
    if (args.futureOnly) {
      fixtures = fixtures.filter(
        (f) => f.kickoff_at != null && new Date(f.kickoff_at) > now
      );
    }
    if (args.fromTime) {
      const cutoffBr = new Date(`${date}T${args.fromTime}:00-03:00`);
      fixtures = fixtures.filter(
        (f) => f.kickoff_at != null && new Date(f.kickoff_at) >= cutoffBr
      );
    }
    targetIds = fixtures
      .sort((a, b) =>
        (a.kickoff_at ?? "").localeCompare(b.kickoff_at ?? "")
      )
      .slice(0, args.maxFixtures)
      .map((f) => f.api_fixture_id);
  }

  console.log(
    `→ FORCE-ANALYZE: ${targetIds.length} fixture(s) alvo`
  );
  if (targetIds.length === 0) {
    console.log("(nada a processar — confira --futureOnly / --fromTime / --date)");
    return;
  }

  // Processa cada fixture via processOneFixture
  interface SnapshotRow {
    api_fixture_id: number;
    match_name: string | null;
    league_name: string | null;
    kickoff_at: string | null;
    readiness: string;
    lineup: number;
    history: number;
    sample3: number;
    dq: number;
    strong: number;
    picks: number;
    reqs: number;
    blocked: string | null;
    warnings: number;
  }
  const summary: SnapshotRow[] = [];

  for (const apiFixtureId of targetIds) {
    console.log(`\n→ processOneFixture(${apiFixtureId})`);
    try {
      const snap = await processOneFixture({
        apiFixtureId,
        dryRun: args.dryRun,
        last: 5,
        persistSchedule: true,
      });
      console.log(
        `   ${snap.readiness}  ${snap.match_name ?? "?"} (${snap.league_name ?? "?"})`
      );
      console.log(
        `   lineup ${snap.lineup_count}p · hist ${snap.players_with_history} · sample3+ ${snap.sample3_count} · dq ${snap.dq_avg.toFixed(2)} · strong ${snap.strong_count} · picks ${snap.picks_drafted} · reqs ${snap.reqs_used}`
      );
      if (snap.blocked_reason) {
        console.log(`   ✗ BLOCKED reason: ${snap.blocked_reason}`);
      }
      for (const w of snap.warnings.slice(0, 3)) {
        console.log(`   ⚠ ${w}`);
      }
      summary.push({
        api_fixture_id: snap.api_fixture_id,
        match_name: snap.match_name,
        league_name: snap.league_name,
        kickoff_at: snap.kickoff_at,
        readiness: snap.readiness,
        lineup: snap.lineup_count,
        history: snap.players_with_history,
        sample3: snap.sample3_count,
        dq: snap.dq_avg,
        strong: snap.strong_count,
        picks: snap.picks_drafted,
        reqs: snap.reqs_used,
        blocked: snap.blocked_reason,
        warnings: snap.warnings.length,
      });
    } catch (err) {
      console.error(
        `   ✗ erro: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Relatório final
  console.log("\n=== FORCE-ANALYZE RELATÓRIO ===");
  console.log(
    "fixture | readiness | lineup | hist | sample3 | dq | strong | picks | reqs"
  );
  for (const r of summary) {
    console.log(
      [
        String(r.api_fixture_id).padStart(8),
        r.readiness.padEnd(10),
        String(r.lineup).padStart(6),
        String(r.history).padStart(5),
        String(r.sample3).padStart(7),
        r.dq.toFixed(2).padStart(4),
        String(r.strong).padStart(6),
        String(r.picks).padStart(5),
        String(r.reqs).padStart(5),
      ].join(" | ")
    );
  }
  // Agregado
  const agg = summary.reduce<Record<string, number>>((a, r) => {
    a[r.readiness] = (a[r.readiness] ?? 0) + 1;
    return a;
  }, {});
  console.log("\n=== Agregado ===");
  for (const [k, v] of Object.entries(agg)) console.log(`  ${k.padEnd(12)} ${v}`);
  const totalReqs = summary.reduce((a, r) => a + r.reqs, 0);
  const totalPicks = summary.reduce((a, r) => a + r.picks, 0);
  console.log(`  reqs usadas: ${totalReqs}`);
  console.log(`  picks gravadas: ${totalPicks}`);

  // Motivos de BLOCKED
  const blocked = summary.filter((r) => r.readiness === "BLOCKED" && r.blocked);
  if (blocked.length > 0) {
    console.log("\n=== Motivos de BLOCKED ===");
    for (const r of blocked) {
      console.log(
        `  ${r.api_fixture_id} ${r.match_name ?? "?"} — ${r.blocked}`
      );
    }
  }

  if (args.dryRun) {
    console.log("\n[dryRun] sem writes. Para aplicar:");
    console.log(
      `  npm run worker:fixture-analysis -- --forceAnalyze=true --futureOnly=${args.futureOnly}${args.fromTime ? ` --fromTime=${args.fromTime}` : ""} --dryRun=false`
    );
  }
}

async function main() {
  const args = parseArgs();
  console.log(
    `→ worker dryRun=${args.dryRun} now=${args.now.toISOString()} max=${args.maxFixtures}`
  );
  console.log(
    `   flags: forceAnalyze=${args.forceAnalyze} futureOnly=${args.futureOnly} fromTime=${args.fromTime ?? "—"} fixture=${args.fixture ?? "—"}\n`
  );

  const { getSupabaseAdmin } = await import("../lib/supabase/admin");
  const { getActiveProvider } = await import("../lib/football-data/provider");
  const { getQuotaSummary } = await import("../lib/api-football/quota");
  const { syncFixturePlayerStats } = await import("../lib/api-football/sync");
  const { runFixturePlayerIntel } = await import("../lib/player-intel");
  const { evaluateFixtureReadinessForPick } = await import(
    "../lib/player-intel/readiness-gate"
  );
  const {
    generateSoloPick,
    generateSafeMulti,
    generateValueMulti,
    generateGameWatchlist,
    saveGeneratedPick,
  } = await import("../lib/player-intel/final-pick-generator");
  const { processOneFixture } = await import(
    "../lib/player-intel/fixture-processor"
  );
  const { getApiQuotaFloor, getApiPlanName, getApiRequestDelayMs } =
    await import("../lib/api-football/config");
  const sb = getSupabaseAdmin();
  const provider = getActiveProvider();
  const QUOTA_FLOOR = getApiQuotaFloor();
  const DELAY_MS = getApiRequestDelayMs();
  console.log(`→ plano=${getApiPlanName()} quota_floor=${QUOTA_FLOOR} delay=${DELAY_MS}ms\n`);

  // ============================================================
  // BRANCH FORCE-ANALYZE: ignora janela temporal. Processa fixtures
  // por (a) --fixture=ID OU (b) --futureOnly/--fromTime sobre o catálogo.
  // ============================================================
  if (args.forceAnalyze || args.fixture != null) {
    return await runForceAnalyze(args, sb);
  }

  // Janela ampla: pega tudo entre [now-2h, now+24h] para filtrar por fase
  const lowerIso = new Date(args.now.getTime() - 2 * 60 * 60_000).toISOString();
  const upperIso = new Date(args.now.getTime() + 24 * 60 * 60_000).toISOString();

  const { data: scheduled, error } = await sb
    .from("fixture_analysis_schedule")
    .select(
      "id, api_fixture_id, fixture_id, match_name, league_name, kickoff_at, status, lineup_source, players_resolved, players_total, sample3_count, data_quality_score, readiness_level, readiness_score"
    )
    .gte("kickoff_at", lowerIso)
    .lt("kickoff_at", upperIso)
    .order("kickoff_at", { ascending: true })
    .limit(args.maxFixtures);
  if (error) {
    if (error.message.includes("fixture_analysis_schedule")) {
      console.error(
        `\n✗ Tabela fixture_analysis_schedule não existe.`
      );
      console.error(
        `  Aplique a migration 018 no Supabase SQL Editor:`
      );
      console.error(
        `  supabase/migrations/018_fixture_analysis_schedule.sql`
      );
      process.exit(2);
    }
    console.error(`✗ select schedule: ${error.message}`);
    process.exit(1);
  }

  const rows = (scheduled ?? []) as ScheduleRow[];
  if (rows.length === 0) {
    console.log(`(nenhum fixture na janela)`);
    console.log(
      `\nDica: rode antes 'npm run schedule:fixtures -- --date=<DATA> --dryRun=false' para agendar.`
    );
    process.exit(0);
  }
  console.log(`→ ${rows.length} fixtures na janela`);

  const results: ResultRow[] = [];

  for (const row of rows) {
    const r: ResultRow = {
      api_fixture_id: row.api_fixture_id,
      match_name: row.match_name ?? "?",
      phase: "stale",
      action_taken: "",
      reqs_used: 0,
      new_status: row.status,
      warnings: [],
    };

    if (!row.kickoff_at) {
      r.action_taken = "sem kickoff — skip";
      results.push(r);
      continue;
    }
    const kickoff = new Date(row.kickoff_at);
    r.phase = decidePhase(args.now, kickoff);

    const minToKickoff = Math.round(
      (kickoff.getTime() - args.now.getTime()) / 60_000
    );
    console.log(
      `\n→ ${row.api_fixture_id} ${row.match_name} (T${minToKickoff > 0 ? "−" : "+"}${Math.abs(minToKickoff)}min) phase=${r.phase}`
    );

    if (r.phase === "noop_far" || r.phase === "kickoff_imminent" || r.phase === "in_progress" || r.phase === "stale") {
      r.action_taken = `phase=${r.phase} — sem ação`;
      results.push(r);
      continue;
    }

    // ============================================================
    // PHASE: precheck OR second_pass
    //   - sync lineup
    //   - se OK, coletar last5, gerar board
    // ============================================================
    if (r.phase === "precheck" || r.phase === "second_pass") {
      // 1. Lineup sync
      const { count: lineupCount } = await sb
        .from("football_lineup_players")
        .select("*", { count: "exact", head: true })
        .eq("fixture_id", row.fixture_id ?? "");
      const hasLineup = (lineupCount ?? 0) > 0;
      const forceResync = r.phase === "second_pass";

      if (!hasLineup || forceResync) {
        if (args.dryRun) {
          r.action_taken += `[dry] lineup sync (${hasLineup ? "force" : "missing"}); `;
        } else {
          const q = await getQuotaSummary().catch(() => null);
          if (q && q.remaining <= QUOTA_FLOOR) {
            r.warnings.push(`quota baixa, pulando lineup sync`);
          } else {
            try {
              const lu = await provider.syncFixtureLineups(row.api_fixture_id);
              r.reqs_used += 1;
              r.action_taken += `lineup synced (${lu.total_players}p); `;
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
              await sleep(DELAY_MS);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              r.warnings.push(`lineup sync: ${msg.slice(0, 120)}`);
              if (isPlanLimitError(msg)) {
                console.error("  ⛔ Plano bloqueou lineup. Demais fixtures vão pular.");
              }
              await sb
                .from("fixture_analysis_schedule")
                .update({
                  last_lineup_check_at: new Date().toISOString(),
                  status: "lineup_missing",
                  error_message: msg.slice(0, 200),
                })
                .eq("id", row.id);
              r.new_status = "lineup_missing";
              results.push(r);
              continue;
            }
          }
        }
      } else {
        r.action_taken += `lineup já presente; `;
      }

      // 2. Last5 collect (só em real e se quota ok)
      if (!args.dryRun) {
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
          const q = await getQuotaSummary().catch(() => null);
          if (q && q.remaining <= QUOTA_FLOOR) {
            r.warnings.push(`quota baixa antes last5 team=${apiTeamId}`);
            break;
          }
          try {
            const reqs = await collectLast5ForTeam(
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
            r.warnings.push(`last5 team=${apiTeamId}: ${msg.slice(0, 120)}`);
            if (isPlanLimitError(msg)) break;
          }
        }
        await sb
          .from("fixture_analysis_schedule")
          .update({
            last_history_collect_at: new Date().toISOString(),
            status: "history_collecting",
          })
          .eq("id", row.id);
        r.new_status = "history_collecting";
      } else {
        r.action_taken += `[dry] last5; `;
      }

      // 3. Board (sem API)
      try {
        const board = await runFixturePlayerIntel(row.api_fixture_id);
        r.action_taken += `board=${board.probabilities_generated}probs; `;
        await sb
          .from("fixture_analysis_schedule")
          .update({
            last_board_generated_at: new Date().toISOString(),
            data_quality_score: board.data_quality_avg,
            players_resolved: board.players_analyzed,
            status: "board_ready",
          })
          .eq("id", row.id);
        r.new_status = "board_ready";
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        r.warnings.push(`board: ${msg.slice(0, 120)}`);
      }
    }

    // ============================================================
    // PHASE: finalize_picks
    //   - readiness final
    //   - se READY: gera solo+safe+value+watchlist drafts
    //   - se WATCHLIST: só watchlist
    // ============================================================
    if (r.phase === "finalize_picks") {
      try {
        const gate = await evaluateFixtureReadinessForPick(row.api_fixture_id);
        r.readiness = gate.level;
        console.log(`   gate: ${gate.level} — ${gate.reason}`);

        const snapshot = {
          readiness: gate.level,
          reason: gate.reason,
          with_history: gate.with_history,
          matched_no_history: gate.matched_no_history,
          synthetic: gate.synthetic,
          offensive_with_history: gate.offensive_with_history,
          avg_data_quality: gate.avg_data_quality,
        };

        let picksCount = 0;
        const pickDate =
          (row.kickoff_at ?? args.now.toISOString()).slice(0, 10);
        const matchName = row.match_name ?? "?";

        async function persist(
          gen: () => Promise<Awaited<ReturnType<typeof generateSoloPick>>>
        ) {
          const p = await gen();
          if (!p) return;
          if (args.dryRun) {
            r.action_taken += `[dry] ${p.risk} (${p.legs.length}l); `;
            picksCount++;
            return;
          }
          try {
            const out = await saveGeneratedPick({
              pick: p,
              pick_date: pickDate,
              match_name: matchName,
              league_name: row.league_name,
              kickoff_at: row.kickoff_at,
              generation_stage: "final",
              readiness_snapshot: snapshot,
              status: "draft",
            });
            if (out.pick_id) picksCount++;
            r.action_taken += `${p.risk}(${p.legs.length}l)+`;
          } catch (err) {
            r.warnings.push(
              `${p.risk} save: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }

        if (gate.level === "READY") {
          await persist(() => generateSoloPick(row.api_fixture_id));
          await persist(() => generateSafeMulti(row.api_fixture_id));
          await persist(() => generateValueMulti(row.api_fixture_id));
          await persist(() => generateGameWatchlist(row.api_fixture_id));
        } else if (gate.level === "WATCHLIST") {
          await persist(() => generateGameWatchlist(row.api_fixture_id));
        }

        const newStatus =
          gate.level === "READY"
            ? "picks_draft_ready"
            : gate.level === "WATCHLIST"
              ? "board_ready"
              : "blocked";
        if (!args.dryRun) {
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
        r.picks = picksCount;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        r.warnings.push(`finalize: ${msg.slice(0, 120)}`);
      }
    }

    results.push(r);
  }

  // ============================================================
  // Relatório
  // ============================================================
  console.log("\n=== Relatório do worker ===");
  console.log("fixture | jogo | phase | new_status | reqs | picks | warn");
  for (const r of results) {
    console.log(
      [
        String(r.api_fixture_id).padStart(8),
        r.match_name.slice(0, 30).padEnd(30),
        r.phase.padEnd(18),
        r.new_status.padEnd(20),
        String(r.reqs_used).padStart(4),
        String(r.picks ?? 0).padStart(5),
        String(r.warnings.length).padStart(4),
      ].join(" | ")
    );
  }

  const totalReqs = results.reduce((a, r) => a + r.reqs_used, 0);
  const totalPicks = results.reduce((a, r) => a + (r.picks ?? 0), 0);
  const totalWarn = results.reduce((a, r) => a + r.warnings.length, 0);
  console.log(
    `\nTotais: ${results.length} fixtures · ${totalReqs} reqs · ${totalPicks} picks · ${totalWarn} warnings`
  );

  if (totalWarn > 0) {
    console.log("\n=== Warnings ===");
    for (const r of results) {
      if (r.warnings.length === 0) continue;
      console.log(`  ${r.api_fixture_id}:`);
      for (const w of r.warnings.slice(0, 3)) console.log(`    - ${w}`);
    }
  }

  if (args.dryRun) {
    console.log("\n[dryRun] sem writes. Para aplicar:");
    console.log(`   npm run worker:fixture-analysis -- --dryRun=false`);
  }
  process.exit(0);
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((res) => setTimeout(res, ms));
}

async function collectLast5ForTeam(
  sb: ReturnType<typeof import("../lib/supabase/admin").getSupabaseAdmin>,
  syncFixturePlayerStats: typeof import("../lib/api-football/sync").syncFixturePlayerStats,
  targetApiFixtureId: number,
  apiTeamId: number,
  targetKickoff: string | null,
  last: number,
  quotaFloor: number,
  getQuotaSummary: typeof import("../lib/api-football/quota").getQuotaSummary,
  delayMs: number,
  addWarning: (w: string) => void
): Promise<number> {
  let reqs = 0;
  const { data: localFx } = await sb
    .from("football_fixtures")
    .select("id, api_fixture_id, kickoff_at")
    .or(
      `api_home_team_id.eq.${apiTeamId},api_away_team_id.eq.${apiTeamId}`
    )
    .in("status", FT_STATUSES)
    .lt("kickoff_at", targetKickoff ?? new Date().toISOString())
    .neq("api_fixture_id", targetApiFixtureId)
    .order("kickoff_at", { ascending: false })
    .limit(last);
  const localList = (localFx ?? []) as Array<{
    id: string;
    api_fixture_id: number;
  }>;

  if (localList.length < last) {
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
        last: last + 5,
      });
      reqs += 1;
      const eligible = (body.response ?? []).filter(
        (b) =>
          b.fixture.id !== targetApiFixtureId &&
          b.fixture.date < (targetKickoff ?? "") &&
          FT_STATUSES.includes(b.fixture.status?.short ?? "")
      );
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
  }

  const { data: refreshed } = await sb
    .from("football_fixtures")
    .select("id, api_fixture_id")
    .or(
      `api_home_team_id.eq.${apiTeamId},api_away_team_id.eq.${apiTeamId}`
    )
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
      addWarning(`quota baixa antes de stats fx=${f.api_fixture_id}`);
      break;
    }
    try {
      await syncFixturePlayerStats(f.api_fixture_id);
      reqs += 1;
      await sleep(delayMs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addWarning(`stats ${f.api_fixture_id}: ${msg.slice(0, 120)}`);
      if (msg.toLowerCase().includes("plan") || msg.toLowerCase().includes("free")) {
        throw err;
      }
    }
  }
  return reqs;
}

main().catch((err) => {
  console.error("\n✗ Erro fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
