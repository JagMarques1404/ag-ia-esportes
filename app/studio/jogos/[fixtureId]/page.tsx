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
import { evaluateFixtureReadinessForPick } from "@/lib/player-intel/readiness-gate";
import {
  generateSoloPick,
  generateSafeMulti,
  generateValueMulti,
  generateGameWatchlist,
  type GeneratedPick,
  type PickLeg,
} from "@/lib/player-intel/final-pick-generator";

export const dynamic = "force-dynamic";

// ============================================================
// /studio/jogos/[fixtureId] — detalhe operacional de um jogo (E.0A.11)
//
// Mostra:
//   - fixture meta + readiness
//   - solo / safe / value / watchlist gerados ao vivo
//   - top ações fortes do board com últimos 5 valores
//   - escalações (lineup_players)
// ============================================================

interface FixtureMeta {
  id: string;
  api_fixture_id: number;
  league_name: string | null;
  home_team_name: string | null;
  away_team_name: string | null;
  kickoff_at: string | null;
  status: string | null;
}

interface LineupPlayer {
  player_name: string | null;
  team_id: string | null;
  position: string | null;
  api_player_id: number | null;
  is_starting: boolean | null;
}

interface ProbRow {
  player_name: string;
  action_key: string;
  action_label: string | null;
  line_label: string | null;
  line: number;
  probability: number;
  sample_size: number | null;
  hit_rate: number | null;
  avg_value: number | null;
  last5_values: unknown;
  data_quality_score: number;
  recommendation: string | null;
  data_origin: string | null;
}

async function loadMeta(apiFixtureId: number): Promise<FixtureMeta | null> {
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from("football_fixtures")
    .select(
      "id, api_fixture_id, league_name, home_team_name, away_team_name, kickoff_at, status"
    )
    .eq("api_fixture_id", apiFixtureId)
    .maybeSingle();
  return (data as FixtureMeta) ?? null;
}

async function loadLineup(fixtureId: string): Promise<LineupPlayer[]> {
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from("football_lineup_players")
    .select("player_name, team_id, position, api_player_id, is_starting")
    .eq("fixture_id", fixtureId);
  return (data as LineupPlayer[]) ?? [];
}

async function loadTopProbs(apiFixtureId: number): Promise<ProbRow[]> {
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from("football_player_action_probabilities")
    .select(
      "player_name, action_key, action_label, line_label, line, probability, sample_size, hit_rate, avg_value, last5_values, data_quality_score, recommendation, data_origin"
    )
    .eq("api_fixture_id", apiFixtureId)
    .in("recommendation", ["forte", "monitorar"])
    .order("probability", { ascending: false })
    .limit(20);
  return (data as ProbRow[]) ?? [];
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(0)}%`;
}

function legToLine(l: PickLeg) {
  const last5 = "";
  return (
    <li
      key={`${l.player_name}-${l.action_key}-${l.line}`}
      className="rounded-md border border-border/30 bg-muted/30 px-2 py-1.5 text-xs"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-medium">
          {l.player_name} — {l.market}
        </div>
        <div className="text-primary">{(l.probability * 100).toFixed(0)}%</div>
      </div>
      <div className="text-[10px] text-muted-foreground">
        sample {l.sample_size}
        {" · hit "}
        {fmtPct(l.hit_rate)}
        {l.avg_value != null && ` · média ${l.avg_value.toFixed(2)}`}
        {" · dq "}
        {l.data_quality_score.toFixed(2)}
        {last5}
      </div>
    </li>
  );
}

function PickBlock({ title, pick }: { title: string; pick: GeneratedPick | null }) {
  if (!pick) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{title}</CardTitle>
          <CardDescription className="text-xs">
            Sem leg que passe nos critérios para este nível.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">
          {title}{" "}
          <span className="text-xs text-primary">
            ({pick.legs.length} legs · {(pick.combined_probability * 100).toFixed(0)}%)
          </span>
        </CardTitle>
        <CardDescription className="text-xs">
          confidence {pick.confidence.toFixed(2)}
          {pick.warning && (
            <span className="ml-2 text-yellow-400">⚠ {pick.warning}</span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1.5">{pick.legs.map(legToLine)}</ul>
      </CardContent>
    </Card>
  );
}

export default async function StudioFixtureDetailPage({
  params,
}: {
  params: Promise<{ fixtureId: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { fixtureId } = await params;
  const apiFixtureId = Number.parseInt(fixtureId, 10);
  if (!Number.isFinite(apiFixtureId)) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <main className="container py-8">
          <Card>
            <CardHeader>
              <CardTitle>Fixture inválido</CardTitle>
            </CardHeader>
          </Card>
        </main>
      </div>
    );
  }

  const meta = await loadMeta(apiFixtureId);
  if (!meta) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <main className="container py-8">
          <Card>
            <CardHeader>
              <CardTitle>Fixture não encontrado</CardTitle>
              <CardDescription>api_fixture_id={apiFixtureId}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href="/studio/jogos">← Voltar ao Studio</Link>
              </Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  const matchName = `${meta.home_team_name ?? "?"} × ${meta.away_team_name ?? "?"}`;

  const [lineup, topProbs, gate, solo, safe, value, watchlist] = await Promise.all(
    [
      loadLineup(meta.id),
      loadTopProbs(apiFixtureId),
      evaluateFixtureReadinessForPick(apiFixtureId).catch(() => null),
      generateSoloPick(apiFixtureId).catch(() => null),
      generateSafeMulti(apiFixtureId).catch(() => null),
      generateValueMulti(apiFixtureId).catch(() => null),
      generateGameWatchlist(apiFixtureId).catch(() => null),
    ]
  );

  // Agrupa lineup por team_id
  const teamGroups = new Map<string, LineupPlayer[]>();
  for (const p of lineup) {
    const k = p.team_id ?? "?";
    const arr = teamGroups.get(k) ?? [];
    arr.push(p);
    teamGroups.set(k, arr);
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="container max-w-6xl space-y-6 py-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs text-muted-foreground">
              <Link href="/studio/jogos" className="hover:text-foreground">
                ← Studio
              </Link>{" "}
              · {meta.league_name ?? "?"}
            </div>
            <h1 className="mt-1 text-2xl font-bold">{matchName}</h1>
            <p className="text-sm text-muted-foreground">
              api={meta.api_fixture_id} · {meta.kickoff_at ?? "?"} ·{" "}
              {meta.status ?? "?"}
            </p>
          </div>
        </div>

        {/* Readiness */}
        {gate && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Readiness:{" "}
                <span
                  className={
                    gate.level === "READY"
                      ? "text-green-400"
                      : gate.level === "WATCHLIST"
                        ? "text-yellow-400"
                        : "text-destructive"
                  }
                >
                  {gate.level}
                </span>
              </CardTitle>
              <CardDescription className="text-xs">
                {gate.reason}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <Stat label="lineup" value={`${gate.total_lineup_players}p`} />
              <Stat
                label="com histórico"
                value={`${gate.with_history}`}
              />
              <Stat
                label="ofensivos hist."
                value={`${gate.offensive_with_history}`}
              />
              <Stat
                label="dq médio"
                value={gate.avg_data_quality.toFixed(2)}
              />
            </CardContent>
          </Card>
        )}

        {/* Picks geradas */}
        <div className="grid gap-4 md:grid-cols-2">
          <PickBlock title="Solo (melhor leg sólida)" pick={solo} />
          <PickBlock title="Múltipla segura" pick={safe} />
          <PickBlock title="Múltipla valor" pick={value} />
          <PickBlock title="Watchlist (top 10)" pick={watchlist} />
        </div>

        {/* Top ações do board */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Top 20 ações do board
            </CardTitle>
            <CardDescription className="text-xs">
              Ordenado por probabilidade (forte + monitorar). Inclui dados
              brutos do board.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {topProbs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Sem probabilidades calculadas. Rode o pipeline.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {topProbs.map((p, i) => {
                  const last5 = Array.isArray(p.last5_values)
                    ? (p.last5_values as unknown[]).map((v) => Number(v))
                    : [];
                  return (
                    <li
                      key={`${p.player_name}-${p.action_key}-${i}`}
                      className="rounded-md border border-border/30 bg-muted/30 px-2 py-1.5 text-xs"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div className="font-medium">
                          {p.player_name} — {p.line_label ?? p.action_label ?? p.action_key}
                        </div>
                        <div
                          className={
                            p.recommendation === "forte"
                              ? "text-green-400"
                              : "text-yellow-400"
                          }
                        >
                          {fmtPct(p.probability)}{" "}
                          <span className="text-[10px] text-muted-foreground">
                            ({p.recommendation})
                          </span>
                        </div>
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        sample {p.sample_size ?? 0} · hit {fmtPct(p.hit_rate)} ·
                        média{" "}
                        {p.avg_value != null ? p.avg_value.toFixed(2) : "—"} ·
                        dq {Number(p.data_quality_score).toFixed(2)}
                        {last5.length > 0 && (
                          <span> · série [{last5.join(", ")}]</span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Lineup */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Escalações ({lineup.length} jogadores)
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {Array.from(teamGroups.entries()).map(([teamId, players]) => {
              const teamName =
                teamId === "?"
                  ? "Sem time"
                  : teamId === (lineup[0]?.team_id ?? null) &&
                      teamGroups.size > 1
                    ? meta.home_team_name ?? teamId.slice(0, 8)
                    : meta.away_team_name ?? teamId.slice(0, 8);
              return (
                <div key={teamId}>
                  <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                    {teamName} ({players.length}p)
                  </div>
                  <ul className="space-y-0.5 text-xs">
                    {players.map((p, i) => (
                      <li
                        key={`${teamId}-${i}`}
                        className="flex items-center justify-between"
                      >
                        <span>
                          {p.position ? `[${p.position}] ` : ""}
                          {p.player_name ?? "?"}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {p.api_player_id != null && p.api_player_id >= 800_000_000
                            ? "sintético"
                            : `api=${p.api_player_id}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}
