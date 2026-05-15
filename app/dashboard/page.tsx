import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Navbar } from "@/components/navbar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { getTodayPicks, type DailyPick } from "@/lib/ai/analyst-tools";
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  Activity,
  AlertTriangle,
  CheckCircle2,
  SparklesIcon,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  // Pega dados do dashboard via view
  const { data: dashboard } = await supabase
    .from("vw_user_dashboard")
    .select("*")
    .eq("user_id", user.id)
    .single();

  // Pega framework
  const { data: framework } = await supabase
    .from("framework_settings")
    .select("*")
    .eq("user_id", user.id)
    .single();

  // Apostas abertas
  const { data: openBets } = await supabase
    .from("bets")
    .select("id, total_stake, combined_odd, potential_return, tier, placed_at")
    .eq("user_id", user.id)
    .eq("status", "open")
    .order("placed_at", { ascending: false });

  // Picks do dia (real → public_picks; vazio → exemplos com is_example)
  const todayPicks = await getTodayPicks(user.id);
  const picksAreReal = todayPicks.length > 0 && !todayPicks[0].is_example;

  const balance = dashboard?.current_balance ?? 0;
  const pnlToday = dashboard?.pnl_today ?? 0;
  const roiToday = dashboard?.roi_today ?? 0;
  const lifetimeRoi = dashboard?.lifetime_roi_pct ?? 0;
  const lifetimePnl = dashboard?.lifetime_pnl ?? 0;
  const openCount = dashboard?.open_bets_count ?? 0;
  const stakedToday = dashboard?.staked_today ?? 0;

  // Status framework
  const dailyLimit = balance * ((framework?.daily_limit_pct ?? 12) / 100);
  const stopLoss = -1 * balance * ((framework?.stop_loss_pct ?? 10) / 100);
  const stopWin = balance * ((framework?.stop_win_pct ?? 25) / 100);
  const stakeRemaining = dailyLimit - stakedToday;

  let frameworkStatus: "green" | "yellow" | "red" = "green";
  let frameworkMessage = "Dentro do framework. Pode apostar.";
  if (pnlToday <= stopLoss) {
    frameworkStatus = "red";
    frameworkMessage = `Stop-loss atingido (${framework?.stop_loss_pct}%). Apostas bloqueadas por 24h.`;
  } else if (pnlToday >= stopWin) {
    frameworkStatus = "yellow";
    frameworkMessage = `Stop-win atingido (+${framework?.stop_win_pct}%). Considere sacar.`;
  } else if (stakeRemaining < dailyLimit * 0.2) {
    frameworkStatus = "yellow";
    frameworkMessage = `Próximo do limite diário. Restante hoje: ${formatCurrency(stakeRemaining)}.`;
  }

  // Banca não configurada ainda
  if (balance === 0 && dashboard?.starting_balance === 0) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <main className="container py-8 max-w-2xl">
          <Card>
            <CardHeader>
              <CardTitle>Bem-vindo ao AG IA Esportes</CardTitle>
              <CardDescription>
                Antes de começar, configure sua banca inicial e regras de gestão.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                O sistema vai te ajudar a manter disciplina, registrar todas as apostas e acompanhar seu ROI por liga, mercado e tipo de aposta.
              </p>
              <Button asChild className="w-full">
                <Link href="/settings">Configurar agora</Link>
              </Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="container py-8 space-y-6">
        {/* Alert framework */}
        <Card className={
          frameworkStatus === "red" ? "border-destructive" :
          frameworkStatus === "yellow" ? "border-yellow-500" : "border-green-500"
        }>
          <CardContent className="flex items-center gap-3 py-4">
            {frameworkStatus === "red" && <AlertTriangle className="h-5 w-5 text-destructive" />}
            {frameworkStatus === "yellow" && <AlertTriangle className="h-5 w-5 text-yellow-500" />}
            {frameworkStatus === "green" && <CheckCircle2 className="h-5 w-5 text-green-500" />}
            <p className="text-sm font-medium">{frameworkMessage}</p>
          </CardContent>
        </Card>

        {/* Cards principais */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Saldo Atual</CardTitle>
              <Wallet className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(balance)}</div>
              <p className="text-xs text-muted-foreground">
                Inicial: {formatCurrency(dashboard?.starting_balance ?? 0)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Lucro Hoje</CardTitle>
              {pnlToday >= 0 ? (
                <TrendingUp className="h-4 w-4 text-green-500" />
              ) : (
                <TrendingDown className="h-4 w-4 text-destructive" />
              )}
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${pnlToday >= 0 ? "text-green-500" : "text-destructive"}`}>
                {pnlToday >= 0 ? "+" : ""}{formatCurrency(pnlToday)}
              </div>
              <p className="text-xs text-muted-foreground">
                {formatPercent(roiToday)} de ROI
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">ROI Total</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${lifetimeRoi >= 0 ? "text-green-500" : "text-destructive"}`}>
                {formatPercent(lifetimeRoi)}
              </div>
              <p className="text-xs text-muted-foreground">
                Lucro: {formatCurrency(lifetimePnl)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Apostas Abertas</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{openCount}</div>
              <p className="text-xs text-muted-foreground">
                Stake: {formatCurrency(dashboard?.open_bets_stake ?? 0)}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Limites do dia */}
        <Card>
          <CardHeader>
            <CardTitle>Limites do Dia</CardTitle>
            <CardDescription>Acompanhamento do framework de gestão</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span>Apostado hoje:</span>
              <span className="font-medium">{formatCurrency(stakedToday)} / {formatCurrency(dailyLimit)}</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div
                className={`h-2 rounded-full ${stakedToday / dailyLimit > 0.8 ? "bg-yellow-500" : "bg-primary"}`}
                style={{ width: `${Math.min((stakedToday / dailyLimit) * 100, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-sm">
              <span>Restante:</span>
              <span className="font-medium">{formatCurrency(stakeRemaining)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Picks do Dia — leitura real de public_picks (com fallback exemplo) */}
        <section>
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-semibold">
                <SparklesIcon className="h-4 w-4 text-primary" />
                Picks do Dia
              </h2>
              <p className="text-sm text-muted-foreground">
                Entradas sugeridas com base em leitura estatística, contexto do jogo e gestão de risco.
              </p>
              {picksAreReal ? (
                <p className="mt-1 text-[11px] text-primary/80">
                  Picks publicadas para hoje · {todayPicks.length} entrada(s).
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-yellow-400/80">
                  Preview com exemplos — sem pick publicada ainda para hoje.
                </p>
              )}
            </div>
            <div className="hidden sm:flex gap-2">
              <Button asChild size="sm" variant="outline">
                <Link href="/picks">Ver Picks de Hoje</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/bets/new">Registrar aposta</Link>
              </Button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {todayPicks.map((p) => (
              <DashboardPickCard key={p.id} pick={p} />
            ))}
          </div>

          {/* CTAs mobile (no md, ficam no header acima) */}
          <div className="mt-4 flex gap-2 sm:hidden">
            <Button asChild size="sm" variant="outline" className="flex-1">
              <Link href="/picks">Ver Picks de Hoje</Link>
            </Button>
            <Button asChild size="sm" className="flex-1">
              <Link href="/bets/new">Registrar aposta</Link>
            </Button>
          </div>
        </section>

        {/* Apostas abertas */}
        {openBets && openBets.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Apostas Abertas</CardTitle>
              <CardDescription>{openBets.length} aposta(s) aguardando resultado</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {openBets.map((bet) => (
                  <Link
                    key={bet.id}
                    href={`/bets/${bet.id}`}
                    className="flex items-center justify-between p-3 rounded-md border hover:bg-accent transition-colors"
                  >
                    <div>
                      <p className="text-sm font-medium uppercase">{bet.tier.replace("_", " ")}</p>
                      <p className="text-xs text-muted-foreground">
                        Stake {formatCurrency(bet.total_stake)} × Odd {bet.combined_odd}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-green-500">
                        Retorno: {formatCurrency(bet.potential_return)}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <Button asChild>
            <Link href="/bets/new">Nova Aposta</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/history">Ver Histórico</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/analista" className="inline-flex items-center justify-center gap-2">
              <SparklesIcon className="h-4 w-4" />
              Conversar com Analista IA
            </Link>
          </Button>
        </div>
      </main>
    </div>
  );
}

// ============================================================
// Pick card (dashboard) — versão compacta da pick para o grid de 3
// ============================================================

const DASH_RISK_STYLE: Record<
  DailyPick["risk"],
  { card: string; badge: string }
> = {
  Segura: {
    card: "border-green-500/30 bg-green-500/5",
    badge:
      "border border-green-500/40 bg-green-500/20 text-green-400",
  },
  Valor: {
    card: "border-yellow-500/30 bg-yellow-500/5",
    badge:
      "border border-yellow-500/40 bg-yellow-500/20 text-yellow-400",
  },
  Mega: {
    card: "border-purple-500/30 bg-purple-500/5",
    badge:
      "border border-purple-500/40 bg-purple-500/20 text-purple-400",
  },
};

function DashboardPickCard({ pick }: { pick: DailyPick }) {
  const styles = DASH_RISK_STYLE[pick.risk];
  return (
    <Card className={`${styles.card} flex flex-col`}>
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles.badge}`}
          >
            {pick.risk}
          </span>
          <span className="text-xs text-muted-foreground">{pick.status}</span>
        </div>
        <CardTitle className="text-base">{pick.match}</CardTitle>
        <CardDescription className="text-xs">
          {pick.league}
          {pick.odd_target ? (
            <>
              {" · Odd alvo "}
              <span className="font-bold text-primary">
                {pick.odd_target.toFixed(2)}
              </span>
            </>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <ul className="space-y-1.5 text-sm">
          {pick.markets.slice(0, 3).map((m, i) => (
            <li key={i} className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>
                <span className="font-medium">{m.player}</span>{" "}
                <span className="text-muted-foreground">{m.market}</span>
              </span>
            </li>
          ))}
        </ul>
        {pick.is_example && (
          <span className="inline-flex w-fit items-center rounded-md border border-yellow-500/40 bg-yellow-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-yellow-400">
            Exemplo · sem pick real
          </span>
        )}
        <Button asChild size="sm" variant="outline" className="mt-auto">
          <Link href="/picks">Ver análise completa</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
