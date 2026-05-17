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

export const dynamic = "force-dynamic";

// ============================================================
// /studio/jogos — dashboard temporal de pipeline (Fase E.0A.9)
//
// Lê de fixture_analysis_schedule (agendado pelo worker temporal)
// + public_picks (drafts gerados).
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

interface ScheduleRow {
  id: string;
  api_fixture_id: number;
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
  last_lineup_check_at: string | null;
  last_board_generated_at: string | null;
  last_pick_generated_at: string | null;
}

interface PickRow {
  api_fixture_id: number;
  risk_level: string;
  status: string;
}

interface DisplayRow extends ScheduleRow {
  minutes_to_kickoff: number | null;
  picks_count: number;
  picks_by_risk: Record<string, number>;
}

const STATUS_STYLES: Record<string, { label: string; cls: string }> = {
  scheduled: { label: "AGENDADO", cls: "border-border/60 bg-muted text-muted-foreground" },
  precheck_pending: { label: "PRECHECK", cls: "border-blue-500/40 bg-blue-500/10 text-blue-300" },
  precheck_done: { label: "PRECHECK OK", cls: "border-blue-500/40 bg-blue-500/10 text-blue-300" },
  lineup_pending: { label: "ESCALAÇÃO …", cls: "border-yellow-500/40 bg-yellow-500/10 text-yellow-300" },
  lineup_confirmed: { label: "ESCALAÇÃO OK", cls: "border-green-500/40 bg-green-500/10 text-green-300" },
  lineup_missing: { label: "SEM ESCALAÇÃO", cls: "border-destructive/40 bg-destructive/10 text-destructive" },
  history_collecting: { label: "COLETANDO LAST5", cls: "border-blue-500/40 bg-blue-500/10 text-blue-300" },
  board_ready: { label: "BOARD PRONTO", cls: "border-green-500/40 bg-green-500/10 text-green-300" },
  picks_draft_ready: { label: "PICKS DRAFT", cls: "border-primary/40 bg-primary/10 text-primary" },
  blocked: { label: "BLOQUEADO", cls: "border-destructive/40 bg-destructive/10 text-destructive" },
  failed: { label: "FALHOU", cls: "border-destructive/40 bg-destructive/10 text-destructive" },
};

const READINESS_STYLES: Record<string, string> = {
  READY: "text-green-400",
  WATCHLIST: "text-yellow-400",
  BLOCKED: "text-destructive",
};

async function loadScheduleRows(date: string): Promise<DisplayRow[]> {
  const sb = getSupabaseAdmin();

  const dayStartBr = `${date}T03:00:00Z`;
  const dayEndBr = `${nextDate(date)}T03:00:00Z`;

  const { data: rows } = await sb
    .from("fixture_analysis_schedule")
    .select(
      "id, api_fixture_id, match_name, league_name, kickoff_at, status, lineup_source, players_resolved, players_total, sample3_count, data_quality_score, readiness_level, last_lineup_check_at, last_board_generated_at, last_pick_generated_at"
    )
    .gte("kickoff_at", dayStartBr)
    .lt("kickoff_at", dayEndBr)
    .order("kickoff_at", { ascending: true });
  const scheduleRows = (rows ?? []) as ScheduleRow[];

  if (scheduleRows.length === 0) return [];

  const apiFixtureIds = scheduleRows.map((r) => r.api_fixture_id);
  const { data: picks } = await sb
    .from("public_picks")
    .select("api_fixture_id, risk_level, status")
    .in("api_fixture_id", apiFixtureIds)
    .eq("pick_date", date)
    .in("status", ["draft", "published"]);
  const picksByFx = new Map<
    number,
    { count: number; byRisk: Record<string, number> }
  >();
  for (const p of (picks ?? []) as PickRow[]) {
    const cur = picksByFx.get(p.api_fixture_id) ?? {
      count: 0,
      byRisk: {},
    };
    cur.count++;
    cur.byRisk[p.risk_level] = (cur.byRisk[p.risk_level] ?? 0) + 1;
    picksByFx.set(p.api_fixture_id, cur);
  }

  const now = Date.now();
  return scheduleRows.map((r) => {
    const minutes = r.kickoff_at
      ? Math.round((new Date(r.kickoff_at).getTime() - now) / 60_000)
      : null;
    const picks = picksByFx.get(r.api_fixture_id) ?? {
      count: 0,
      byRisk: {},
    };
    return {
      ...r,
      minutes_to_kickoff: minutes,
      picks_count: picks.count,
      picks_by_risk: picks.byRisk,
    };
  });
}

function formatKickoffRelative(minutes: number | null): string {
  if (minutes == null) return "?";
  if (minutes > 120) {
    const h = Math.round(minutes / 60);
    return `em ${h}h`;
  }
  if (minutes > 0) return `em ${minutes}min`;
  if (minutes > -120) return `há ${Math.abs(minutes)}min`;
  const h = Math.round(Math.abs(minutes) / 60);
  return `há ${h}h`;
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

  const rows = await loadScheduleRows(date);

  const agg = rows.reduce<Record<string, number>>((a, r) => {
    a[r.status] = (a[r.status] ?? 0) + 1;
    return a;
  }, {});
  const totalPicks = rows.reduce((a, r) => a + r.picks_count, 0);
  const readyCount = rows.filter(
    (r) => r.readiness_level === "READY"
  ).length;
  const watchlistCount = rows.filter(
    (r) => r.readiness_level === "WATCHLIST"
  ).length;

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
              Estado do pipeline temporal (E.0A.9). Atualizado pelo worker a
              cada execução.
            </p>
          </div>
          <form className="flex items-end gap-2">
            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground">
                Data (YYYY-MM-DD)
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

        <div className="flex flex-wrap gap-3 text-xs">
          <Pill label="Total" value={rows.length} />
          <Pill label="READY" value={readyCount} cls="text-green-400" />
          <Pill
            label="WATCHLIST"
            value={watchlistCount}
            cls="text-yellow-400"
          />
          <Pill
            label="PICKS DRAFT"
            value={totalPicks}
            cls="text-primary"
          />
          {Object.entries(agg).map(([k, v]) => (
            <Pill
              key={k}
              label={STATUS_STYLES[k]?.label ?? k}
              value={v}
              cls="text-muted-foreground"
            />
          ))}
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
              <CardTitle>Nenhum fixture agendado para essa data</CardTitle>
              <CardDescription>
                Rode o schedule + worker:
                <div className="mt-2 space-y-1 font-mono text-xs">
                  <div className="text-muted-foreground">
                    npm run schedule:fixtures -- --date={date} --dryRun=false
                  </div>
                  <div className="text-muted-foreground">
                    npm run worker:fixture-analysis -- --dryRun=false
                  </div>
                </div>
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Jogos ({rows.length})</CardTitle>
              <CardDescription>
                Dados do worker temporal. Refresh manual ao recarregar a página.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {rows.map((r) => {
                const sty =
                  STATUS_STYLES[r.status] ?? STATUS_STYLES.scheduled;
                const readiness = r.readiness_level ?? "—";
                const readinessCls =
                  READINESS_STYLES[readiness] ?? "text-muted-foreground";
                const dq = Number(r.data_quality_score ?? 0).toFixed(2);
                const playersStr =
                  r.players_resolved != null && r.players_total != null
                    ? `${r.players_resolved}/${r.players_total}`
                    : "—";
                const kickoff = r.kickoff_at?.slice(11, 16) ?? "?";
                return (
                  <div
                    key={r.id}
                    className="flex flex-col gap-2 rounded-md border border-border/40 bg-muted/30 p-3 text-sm sm:flex-row sm:items-start sm:justify-between"
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
                      <div className="mt-1 font-medium">{r.match_name ?? "?"}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        lineup {playersStr}{" "}
                        {r.lineup_source ? `(${r.lineup_source})` : ""} ·
                        sample3+ {r.sample3_count ?? 0} · dq {dq} ·{" "}
                        <span className={readinessCls}>
                          readiness {readiness}
                        </span>
                      </div>
                      {r.picks_count > 0 && (
                        <div className="mt-0.5 text-xs">
                          <span className="text-primary">
                            {r.picks_count} pick(s) draft
                          </span>{" "}
                          <span className="text-muted-foreground">
                            ({Object.entries(r.picks_by_risk)
                              .map(([k, v]) => `${k}:${v}`)
                              .join(", ")})
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="rounded-md border border-border/60 bg-background/40 px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                        api={r.api_fixture_id}
                      </span>
                      {r.picks_count > 0 && (
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/picks?date=${date}`}>Ver picks</Link>
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Comandos operacionais</CardTitle>
            <CardDescription>
              Esta tela é leitura. Pipeline é executado via CLI ou cron.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5 text-xs font-mono">
            <div># 1) agendar fixtures do dia (zero quota)</div>
            <div className="text-muted-foreground">
              npm run schedule:fixtures -- --date={date} --dryRun=false
            </div>
            <div className="mt-2"># 2) rodar worker (T-2h..T-15m → ação)</div>
            <div className="text-muted-foreground">
              npm run worker:fixture-analysis -- --dryRun=false
            </div>
            <div className="mt-2"># 3) cron HTTP (Vercel)</div>
            <div className="text-muted-foreground">
              POST /api/cron/fixture-analysis (header x-cron-secret)
            </div>
            <div className="mt-2"># 4) atalho: pipeline tudo-de-uma-vez</div>
            <div className="text-muted-foreground">
              npm run daily:auto-full -- --date={date} --dryRun=false --maxFixtures=20
            </div>
          </CardContent>
        </Card>
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
