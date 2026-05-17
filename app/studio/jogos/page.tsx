import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { Navbar } from "@/components/navbar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StudioUpcomingMultiButton } from "@/components/studio/upcoming-multi-button";

export const dynamic = "force-dynamic";

// ============================================================
// /studio/jogos — central de decisão por jogo (E.0A.11)
//
// Lê de fixture_analysis_schedule + recalcula agregados ao vivo
// (lineup count, probs, picks) para não exibir "BOARD PRONTO" com
// dq=0.
// ============================================================

function todayBrIso(): string {
  const now = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return now.toISOString().split("T")[0];
}

function nextDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split("T")[0];
}

type DisplayStatus =
  | "PICKS_DRAFT"
  | "READY"
  | "WATCHLIST"
  | "BOARD_INCOMPLETO"
  | "SEM_LINEUP"
  | "AGENDADO"
  | "EM_ANDAMENTO"
  | "BLOQUEADO";

interface ScheduleRow {
  id: string;
  api_fixture_id: number;
  fixture_id: string | null;
  match_name: string | null;
  league_name: string | null;
  kickoff_at: string | null;
  status: string;
  lineup_source: string | null;
  readiness_level: string | null;
  data_quality_score: number | null;
}

interface DisplayRow {
  id: string;
  api_fixture_id: number;
  match_name: string;
  league_name: string | null;
  kickoff_at: string | null;
  minutes_to_kickoff: number | null;
  lineup_count: number;
  players_with_history: number;
  sample3_count: number;
  dq_avg: number;
  strong_count: number;
  picks_count: number;
  picks_by_risk: Record<string, number>;
  schedule_status: string;
  readiness: string | null;
  lineup_source: string | null;
  display_status: DisplayStatus;
}

interface FixtureRow {
  id: string;
  api_fixture_id: number;
  league_name: string | null;
  home_team_name: string | null;
  away_team_name: string | null;
  kickoff_at: string | null;
}

const STATUS_STYLES: Record<DisplayStatus, { label: string; cls: string }> = {
  PICKS_DRAFT: { label: "PICKS DRAFT", cls: "border-primary/40 bg-primary/10 text-primary" },
  READY: { label: "READY", cls: "border-green-500/40 bg-green-500/10 text-green-300" },
  WATCHLIST: { label: "WATCHLIST", cls: "border-yellow-500/40 bg-yellow-500/10 text-yellow-300" },
  BOARD_INCOMPLETO: { label: "BOARD INCOMPLETO", cls: "border-orange-500/40 bg-orange-500/10 text-orange-300" },
  SEM_LINEUP: { label: "SEM LINEUP", cls: "border-border/60 bg-muted text-muted-foreground" },
  AGENDADO: { label: "AGENDADO", cls: "border-border/60 bg-muted text-muted-foreground" },
  EM_ANDAMENTO: { label: "EM ANDAMENTO", cls: "border-blue-500/40 bg-blue-500/10 text-blue-300" },
  BLOQUEADO: { label: "BLOQUEADO", cls: "border-destructive/40 bg-destructive/10 text-destructive" },
};

function decideDisplayStatus(args: {
  hasPicks: boolean;
  readiness: string | null;
  lineup: number;
  sample3: number;
  dq: number;
  strong: number;
  minutesToKickoff: number | null;
  scheduleStatus: string;
}): DisplayStatus {
  const {
    hasPicks,
    readiness,
    lineup,
    sample3,
    dq,
    strong,
    minutesToKickoff,
    scheduleStatus,
  } = args;

  if (hasPicks) return "PICKS_DRAFT";
  if (readiness === "BLOCKED" && lineup > 0) return "BLOQUEADO";
  if (minutesToKickoff != null && minutesToKickoff < 0) {
    return "EM_ANDAMENTO";
  }
  if (lineup === 0) {
    if (scheduleStatus === "lineup_missing") return "SEM_LINEUP";
    return "AGENDADO";
  }
  // Tem lineup mas board não foi gerado ou está vazio.
  if (sample3 === 0 || dq === 0 || strong === 0) return "BOARD_INCOMPLETO";
  if (readiness === "READY" && dq >= 0.65 && sample3 >= 5) return "READY";
  if (readiness === "WATCHLIST" || readiness === null) return "WATCHLIST";
  return "WATCHLIST";
}

async function loadFixtures(date: string): Promise<DisplayRow[]> {
  const sb = getSupabaseAdmin();
  const dayStartBr = `${date}T03:00:00Z`;
  const dayEndBr = `${nextDate(date)}T03:00:00Z`;

  const { data: catalogIds } = await sb
    .from("football_leagues_catalog")
    .select("api_league_id")
    .eq("is_auto_pick", true);
  const autoPickIds = (catalogIds ?? [])
    .map((r) => Number(r.api_league_id))
    .filter((n) => Number.isFinite(n));

  function buildQuery() {
    let q = sb
      .from("football_fixtures")
      .select(
        "id, api_fixture_id, league_name, home_team_name, away_team_name, kickoff_at"
      )
      .order("kickoff_at", { ascending: true, nullsFirst: false });
    if (autoPickIds.length > 0) q = q.in("api_league_id", autoPickIds);
    return q;
  }
  const [byDate, byKick] = await Promise.all([
    buildQuery().eq("date", date),
    buildQuery().gte("kickoff_at", dayStartBr).lt("kickoff_at", dayEndBr),
  ]);
  const merged = new Map<number, FixtureRow>();
  for (const r of (byDate.data ?? []) as FixtureRow[])
    merged.set(r.api_fixture_id, r);
  for (const r of (byKick.data ?? []) as FixtureRow[])
    if (!merged.has(r.api_fixture_id)) merged.set(r.api_fixture_id, r);
  const fixtures = Array.from(merged.values()).sort((a, b) =>
    (a.kickoff_at ?? "").localeCompare(b.kickoff_at ?? "")
  );

  if (fixtures.length === 0) return [];

  const fixtureIds = fixtures.map((f) => f.id);
  const apiFixtureIds = fixtures.map((f) => f.api_fixture_id);

  const [
    { data: scheduleRows },
    { data: lineupRows },
    { data: probsRows },
    { data: picks },
  ] = await Promise.all([
    sb
      .from("fixture_analysis_schedule")
      .select(
        "id, api_fixture_id, fixture_id, match_name, league_name, kickoff_at, status, lineup_source, readiness_level, data_quality_score"
      )
      .in("api_fixture_id", apiFixtureIds),
    sb
      .from("football_lineup_players")
      .select("fixture_id, api_player_id")
      .in("fixture_id", fixtureIds),
    sb
      .from("football_player_action_probabilities")
      .select(
        "api_fixture_id, recommendation, sample_size, data_quality_score"
      )
      .in("api_fixture_id", apiFixtureIds),
    sb
      .from("public_picks")
      .select("api_fixture_id, risk_level, status")
      .in("api_fixture_id", apiFixtureIds)
      .eq("pick_date", date)
      .in("status", ["draft", "published"]),
  ]);

  const scheduleByFx = new Map<number, ScheduleRow>();
  for (const r of (scheduleRows ?? []) as ScheduleRow[])
    scheduleByFx.set(r.api_fixture_id, r);

  // Lineup count + players com api_player_id real (não sintético)
  const lineupCountByFx = new Map<string, number>();
  const realPlayersByFx = new Map<string, number>();
  const SYNTHETIC_MIN = 800_000_000;
  for (const r of (lineupRows ?? []) as Array<{
    fixture_id: string;
    api_player_id: number | null;
  }>) {
    lineupCountByFx.set(
      r.fixture_id,
      (lineupCountByFx.get(r.fixture_id) ?? 0) + 1
    );
    if (
      r.api_player_id != null &&
      r.api_player_id > 0 &&
      r.api_player_id < SYNTHETIC_MIN
    ) {
      realPlayersByFx.set(
        r.fixture_id,
        (realPlayersByFx.get(r.fixture_id) ?? 0) + 1
      );
    }
  }

  // Probs aggregate
  interface ProbAgg {
    strong: number;
    sample3: number;
    dqSum: number;
    dqCount: number;
  }
  const probsByFx = new Map<number, ProbAgg>();
  for (const r of (probsRows ?? []) as Array<{
    api_fixture_id: number;
    recommendation: string | null;
    sample_size: number | null;
    data_quality_score: number | null;
  }>) {
    const cur = probsByFx.get(r.api_fixture_id) ?? {
      strong: 0,
      sample3: 0,
      dqSum: 0,
      dqCount: 0,
    };
    if (r.recommendation === "forte") cur.strong++;
    if ((r.sample_size ?? 0) >= 3) cur.sample3++;
    const dq = Number(r.data_quality_score);
    if (Number.isFinite(dq) && dq > 0) {
      cur.dqSum += dq;
      cur.dqCount++;
    }
    probsByFx.set(r.api_fixture_id, cur);
  }

  const picksByFx = new Map<
    number,
    { count: number; byRisk: Record<string, number> }
  >();
  for (const p of (picks ?? []) as Array<{
    api_fixture_id: number;
    risk_level: string;
    status: string;
  }>) {
    const cur = picksByFx.get(p.api_fixture_id) ?? { count: 0, byRisk: {} };
    cur.count++;
    cur.byRisk[p.risk_level] = (cur.byRisk[p.risk_level] ?? 0) + 1;
    picksByFx.set(p.api_fixture_id, cur);
  }

  const now = Date.now();
  return fixtures.map((fx) => {
    const schedule = scheduleByFx.get(fx.api_fixture_id);
    const lineup = lineupCountByFx.get(fx.id) ?? 0;
    const realPlayers = realPlayersByFx.get(fx.id) ?? 0;
    const agg = probsByFx.get(fx.api_fixture_id) ?? {
      strong: 0,
      sample3: 0,
      dqSum: 0,
      dqCount: 0,
    };
    const dq = agg.dqCount > 0 ? agg.dqSum / agg.dqCount : 0;
    const picksAgg = picksByFx.get(fx.api_fixture_id) ?? {
      count: 0,
      byRisk: {},
    };
    const minutes = fx.kickoff_at
      ? Math.round((new Date(fx.kickoff_at).getTime() - now) / 60_000)
      : null;

    const display: DisplayRow = {
      id: fx.id,
      api_fixture_id: fx.api_fixture_id,
      match_name: `${fx.home_team_name ?? "?"} × ${fx.away_team_name ?? "?"}`,
      league_name: fx.league_name,
      kickoff_at: fx.kickoff_at,
      minutes_to_kickoff: minutes,
      lineup_count: lineup,
      players_with_history: realPlayers,
      sample3_count: agg.sample3,
      dq_avg: Number(dq.toFixed(3)),
      strong_count: agg.strong,
      picks_count: picksAgg.count,
      picks_by_risk: picksAgg.byRisk,
      schedule_status: schedule?.status ?? "scheduled",
      readiness: schedule?.readiness_level ?? null,
      lineup_source: schedule?.lineup_source ?? null,
      display_status: "AGENDADO",
    };

    display.display_status = decideDisplayStatus({
      hasPicks: display.picks_count > 0,
      readiness: display.readiness,
      lineup: display.lineup_count,
      sample3: display.sample3_count,
      dq: display.dq_avg,
      strong: display.strong_count,
      minutesToKickoff: display.minutes_to_kickoff,
      scheduleStatus: display.schedule_status,
    });

    return display;
  });
}

function formatKickoffRelative(minutes: number | null): string {
  if (minutes == null) return "?";
  if (minutes > 120) return `em ${Math.round(minutes / 60)}h`;
  if (minutes > 0) return `em ${minutes}min`;
  if (minutes > -120) return `há ${Math.abs(minutes)}min`;
  return `há ${Math.round(Math.abs(minutes) / 60)}h`;
}

export default async function StudioJogosPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const params = await searchParams;
  const date =
    params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
      ? params.date
      : todayBrIso();

  const rows = await loadFixtures(date);

  const agg = rows.reduce<Record<string, number>>((a, r) => {
    a[r.display_status] = (a[r.display_status] ?? 0) + 1;
    return a;
  }, {});
  const totalPicks = rows.reduce((a, r) => a + r.picks_count, 0);

  const prev = (() => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().split("T")[0];
  })();
  const next = nextDate(date);

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="container max-w-6xl space-y-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Jogos do dia — Studio</h1>
            <p className="text-sm text-muted-foreground">
              Central de decisão estatística. Status recalculado ao vivo.
            </p>
          </div>
          <form className="flex items-end gap-2">
            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground">
                Data
              </label>
              <input
                type="text"
                name="date"
                defaultValue={date}
                className="block rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <Button type="submit" size="sm">
              Carregar
            </Button>
          </form>
        </div>

        <StudioUpcomingMultiButton date={date} />

        <div className="flex flex-wrap gap-3 text-xs">
          <Pill label="Total" value={rows.length} />
          <Pill
            label="PICKS DRAFT"
            value={agg.PICKS_DRAFT ?? 0}
            cls="text-primary"
          />
          <Pill label="READY" value={agg.READY ?? 0} cls="text-green-400" />
          <Pill
            label="WATCHLIST"
            value={agg.WATCHLIST ?? 0}
            cls="text-yellow-400"
          />
          <Pill
            label="INCOMPLETO"
            value={agg.BOARD_INCOMPLETO ?? 0}
            cls="text-orange-400"
          />
          <Pill
            label="SEM LINEUP"
            value={agg.SEM_LINEUP ?? 0}
            cls="text-muted-foreground"
          />
          <Pill
            label="AGENDADO"
            value={agg.AGENDADO ?? 0}
            cls="text-muted-foreground"
          />
          <Pill
            label="ANDAMENTO"
            value={agg.EM_ANDAMENTO ?? 0}
            cls="text-blue-400"
          />
          <Pill
            label="BLOQUEADO"
            value={agg.BLOQUEADO ?? 0}
            cls="text-destructive"
          />
          {totalPicks > 0 && (
            <Pill
              label="picks total"
              value={totalPicks}
              cls="text-primary"
            />
          )}
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <Button asChild size="sm" variant="outline">
            <Link href={`/studio/jogos?date=${prev}`}>← {prev}</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={`/studio/jogos?date=${todayBrIso()}`}>hoje</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={`/studio/jogos?date=${next}`}>{next} →</Link>
          </Button>
        </div>

        {rows.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Nenhum fixture nessa data</CardTitle>
              <CardDescription>
                Rode o pipeline:
                <div className="mt-2 font-mono text-xs text-muted-foreground">
                  npm run daily:auto-full -- --date={date} --dryRun=false
                </div>
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Jogos ({rows.length})</CardTitle>
              <CardDescription>
                Status recomputado de lineup + probs + picks. Clique no jogo
                para ver detalhes.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {rows.map((r) => {
                const sty = STATUS_STYLES[r.display_status];
                const kickoff = r.kickoff_at?.slice(11, 16) ?? "?";
                return (
                  <Link
                    href={`/studio/jogos/${r.api_fixture_id}`}
                    key={r.id}
                    className="flex flex-col gap-2 rounded-md border border-border/40 bg-muted/30 p-3 text-sm transition-colors hover:bg-muted/60 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${sty.cls}`}
                        >
                          {sty.label}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {kickoff}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          ({formatKickoffRelative(r.minutes_to_kickoff)})
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {r.league_name ?? "?"}
                        </span>
                      </div>
                      <div className="mt-1 font-medium">{r.match_name}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        lineup {r.lineup_count}p ({r.players_with_history}{" "}
                        com histórico) · sample3+ {r.sample3_count} · dq{" "}
                        {r.dq_avg.toFixed(2)} · ações fortes{" "}
                        {r.strong_count}
                        {r.lineup_source ? ` · ${r.lineup_source}` : ""}
                      </div>
                      {r.picks_count > 0 && (
                        <div className="mt-0.5 text-xs">
                          <span className="text-primary">
                            {r.picks_count} pick(s) draft:
                          </span>{" "}
                          {Object.entries(r.picks_by_risk)
                            .map(([k, v]) => `${k}:${v}`)
                            .join(", ")}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="rounded-md border border-border/60 bg-background/40 px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                        api={r.api_fixture_id}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        ver detalhe →
                      </span>
                    </div>
                  </Link>
                );
              })}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}

function Pill({
  label,
  value,
  cls,
}: {
  label: string;
  value: number;
  cls?: string;
}) {
  return (
    <div
      className={`inline-flex items-baseline gap-1 rounded-md border border-border/40 bg-background/40 px-2 py-1 ${cls ?? ""}`}
    >
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
