import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCurrency, formatDate, formatPercent } from "@/lib/utils";
import { BetLegsActions, type LegRow } from "@/components/bet-legs-actions";
import type { BetStatus } from "@/types";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<BetStatus, string> = {
  open: "Aberta",
  won: "Ganha",
  lost: "Perdida",
  cashed_out: "Cashout",
  void: "Anulada",
  partial: "Parcial",
};

const STATUS_STYLES: Record<BetStatus, string> = {
  open: "bg-yellow-500/20 text-yellow-400 border-yellow-500/40",
  won: "bg-green-500/20 text-green-400 border-green-500/40",
  lost: "bg-destructive/20 text-destructive border-destructive/40",
  cashed_out: "bg-blue-500/20 text-blue-400 border-blue-500/40",
  void: "bg-muted text-muted-foreground border-border/40",
  partial: "bg-purple-500/20 text-purple-400 border-purple-500/40",
};

export default async function BetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: bet } = await supabase
    .from("bets")
    .select(
      "id, user_id, bet_type, tier, total_stake, combined_odd, potential_return, estimated_prob_pct, estimated_ev_pct, bookmaker, notes, status, result_value, placed_at, settled_at, was_recommended, followed_framework"
    )
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!bet) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <main className="container max-w-2xl py-10">
          <Card>
            <CardHeader>
              <CardTitle>Aposta não encontrada</CardTitle>
              <CardDescription>
                Esta aposta não existe ou não pertence à sua conta.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href="/dashboard">Voltar ao Dashboard</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/history">Ver Histórico</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/bets/new">Nova Aposta</Link>
              </Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  const { data: legs } = await supabase
    .from("bet_legs")
    .select(
      "id, bet_id, competition, home_team, away_team, market_type, selection, odd_value, estimated_prob_pct, result, position, player_name, line, actual_value, notes"
    )
    .eq("bet_id", bet.id)
    .order("position", { ascending: true });

  const status = bet.status as BetStatus;
  const stake = Number(bet.total_stake) || 0;
  const odd = Number(bet.combined_odd) || 0;
  const potential = Number(bet.potential_return) || stake * odd;
  const result = Number(bet.result_value) || 0;
  const isResolved =
    status !== "open" && status !== "partial";
  const pnl = isResolved ? result - stake : null;
  const roi = isResolved && stake > 0 ? (pnl! / stake) * 100 : null;

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="container max-w-3xl space-y-6 py-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Aposta</h1>
            <p className="text-sm text-muted-foreground">
              ID: <span className="font-mono">{bet.id.slice(0, 8)}…</span>
            </p>
          </div>
          <span
            className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${STATUS_STYLES[status]}`}
          >
            {STATUS_LABELS[status] ?? status}
          </span>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base uppercase tracking-wide">
              {String(bet.tier).replace("_", " ")} · {bet.bet_type}
            </CardTitle>
            <CardDescription>
              Registrada em {formatDate(bet.placed_at)}
              {bet.settled_at ? ` · Resolvida em ${formatDate(bet.settled_at)}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
            <Field label="Stake" value={formatCurrency(stake)} />
            <Field label="Odd combinada" value={odd.toFixed(2)} />
            <Field
              label="Retorno potencial"
              value={formatCurrency(potential)}
              highlightClass="text-green-400"
            />
            <Field
              label="Lucro líquido (potencial)"
              value={formatCurrency(potential - stake)}
            />
            {bet.estimated_prob_pct != null && (
              <Field
                label="Prob estimada (no registro)"
                value={`${Number(bet.estimated_prob_pct).toFixed(1)}%`}
              />
            )}
            {bet.estimated_ev_pct != null && (
              <Field
                label="EV estimado (no registro)"
                value={formatPercent(Number(bet.estimated_ev_pct))}
              />
            )}
            {bet.bookmaker && <Field label="Casa" value={bet.bookmaker} />}
            <Field
              label="Dentro do framework"
              value={bet.followed_framework ? "Sim" : "Não"}
            />
            {isResolved && (
              <>
                <Field
                  label="Valor recebido"
                  value={formatCurrency(result)}
                  highlightClass={
                    pnl != null && pnl >= 0 ? "text-green-400" : "text-destructive"
                  }
                />
                <Field
                  label="P&L da aposta"
                  value={formatCurrency(pnl ?? 0)}
                  highlightClass={
                    pnl != null && pnl >= 0 ? "text-green-400" : "text-destructive"
                  }
                />
                {roi != null && (
                  <Field
                    label="ROI desta aposta"
                    value={formatPercent(roi)}
                    highlightClass={
                      roi >= 0 ? "text-green-400" : "text-destructive"
                    }
                  />
                )}
              </>
            )}
          </CardContent>
        </Card>

        {bet.notes && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Observações</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm">{bet.notes}</p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pernas / Seleções</CardTitle>
            <CardDescription>
              {legs?.length ?? 0} perna(s) — marque green/red/void abaixo para
              liquidar a aposta automaticamente.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BetLegsActions
              betId={bet.id}
              initialLegs={(legs ?? []) as LegRow[]}
              initialBetStatus={bet.status as string}
            />
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-3">
          <Button asChild>
            <Link href="/dashboard">Voltar ao Dashboard</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/history">Ver Histórico</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/bets/new">Nova Aposta</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}

function Field({
  label,
  value,
  highlightClass,
}: {
  label: string;
  value: string;
  highlightClass?: string;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`text-base font-medium ${highlightClass ?? ""}`}>
        {value}
      </div>
    </div>
  );
}
