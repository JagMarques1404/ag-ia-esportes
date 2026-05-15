"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { formatCurrency, formatDate, formatPercent } from "@/lib/utils";
import type { Bet, BetLeg, BetStatus } from "@/types";

export default function HistoryPage() {
  const supabase = createClient();
  const [bets, setBets] = useState<(Bet & { bet_legs: BetLeg[] })[]>([]);
  const [filter, setFilter] = useState<"all" | "open" | "won" | "lost">("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      let query = supabase
        .from("bets")
        .select("*, bet_legs(*)")
        .eq("user_id", user.id)
        .order("placed_at", { ascending: false });
      if (filter !== "all") query = query.eq("status", filter);
      const { data } = await query;
      setBets((data as any) ?? []);
      setLoading(false);
    }
    load();
  }, [supabase, filter]);

  function statusBadge(status: BetStatus) {
    const styles: Record<BetStatus, string> = {
      open: "bg-yellow-500/20 text-yellow-500",
      won: "bg-green-500/20 text-green-500",
      lost: "bg-destructive/20 text-destructive",
      cashed_out: "bg-blue-500/20 text-blue-500",
      void: "bg-muted text-muted-foreground",
      partial: "bg-purple-500/20 text-purple-500",
    };
    const labels: Record<BetStatus, string> = {
      open: "Aberta", won: "Ganha", lost: "Perdida",
      cashed_out: "Cashout", void: "Anulada", partial: "Parcial",
    };
    return (
      <span className={`text-xs px-2 py-1 rounded-md ${styles[status]}`}>
        {labels[status]}
      </span>
    );
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="container py-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Histórico</h1>
          <Select value={filter} onValueChange={(v: any) => setFilter(v)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="open">Abertas</SelectItem>
              <SelectItem value="won">Ganhas</SelectItem>
              <SelectItem value="lost">Perdidas</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading && <p>Carregando...</p>}
        {!loading && bets.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Nenhuma aposta encontrada.
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {bets.map((bet) => (
            <Card key={bet.id}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    {statusBadge(bet.status)}
                    <CardTitle className="text-base uppercase">{bet.tier.replace("_", " ")}</CardTitle>
                  </div>
                  <p className="text-xs text-muted-foreground">{formatDate(bet.placed_at)}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium">Stake: {formatCurrency(bet.total_stake)}</p>
                  <p className="text-xs text-muted-foreground">Odd {bet.combined_odd}</p>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  {bet.bet_legs?.map((leg) => (
                    <div key={leg.id} className="text-sm border-l-2 border-muted pl-3 py-1">
                      <p className="font-medium">{leg.home_team} × {leg.away_team}</p>
                      <p className="text-muted-foreground text-xs">{leg.competition}</p>
                      <p className="text-xs">{leg.market_type}: <strong>{leg.selection}</strong> @ {leg.odd_value}</p>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between pt-2 border-t">
                  <div className="text-sm">
                    <span className="text-muted-foreground">Retorno potencial:</span>{" "}
                    <span className="font-medium text-green-500">{formatCurrency(bet.potential_return)}</span>
                  </div>
                  {bet.estimated_prob_pct && (
                    <div className="text-sm">
                      <span className="text-muted-foreground">Prob:</span>{" "}
                      <span className="font-medium">{bet.estimated_prob_pct.toFixed(1)}%</span>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t">
                  {bet.status !== "open" ? (
                    <div className="text-sm">
                      <span className="text-muted-foreground">Resultado:</span>{" "}
                      <span className={`font-medium ${
                        bet.result_value > bet.total_stake ? "text-green-500" :
                        bet.result_value < bet.total_stake ? "text-destructive" : ""
                      }`}>
                        {formatCurrency(bet.result_value)} ({formatPercent(((bet.result_value - bet.total_stake) / bet.total_stake) * 100)})
                      </span>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      Marque green/red/void por leg para liquidar a aposta.
                    </div>
                  )}
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/bets/${bet.id}`}>Abrir aposta</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
