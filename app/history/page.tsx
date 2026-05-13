"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { formatCurrency, formatDate, formatPercent } from "@/lib/utils";
import type { Bet, BetLeg, BetStatus } from "@/types";

export default function HistoryPage() {
  const router = useRouter();
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

  async function resolveBet(bet: Bet, status: "won" | "lost" | "cashed_out", cashoutValue?: number) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const resultValue =
      status === "won" ? bet.potential_return :
      status === "cashed_out" ? (cashoutValue ?? 0) :
      0;

    await supabase.from("bets").update({
      status,
      result_value: resultValue,
      settled_at: new Date().toISOString(),
    }).eq("id", bet.id);

    // Atualiza bankroll
    const { data: br } = await supabase.from("bankroll").select("*").eq("user_id", user.id).single();
    if (br) {
      const newBalance = Number(br.current_balance) + resultValue;
      const newTotalReturned = Number(br.total_returned) + resultValue;
      const newStreakType = status === "won" || (status === "cashed_out" && resultValue > Number(bet.total_stake)) ? "win" : "loss";
      const newStreakCount = br.current_streak_type === newStreakType ? Number(br.current_streak_count) + 1 : 1;

      await supabase.from("bankroll").update({
        current_balance: newBalance,
        total_returned: newTotalReturned,
        current_streak_type: newStreakType,
        current_streak_count: newStreakCount,
      }).eq("user_id", user.id);

      await supabase.from("bankroll_log").insert({
        user_id: user.id,
        type: status === "won" ? "bet_win" : status === "cashed_out" ? "cashout" : "bet_loss",
        amount: resultValue,
        balance_after: newBalance,
        reference_id: bet.id,
        description: `Aposta ${status} — ${bet.tier}`,
      });
    }

    router.refresh();
    setBets(bets.map(b => b.id === bet.id ? { ...b, status, result_value: resultValue } as any : b));
  }

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

                {bet.status === "open" && (
                  <div className="flex gap-2 pt-2">
                    <Button size="sm" variant="default" onClick={() => resolveBet(bet, "won")}>
                      Ganhou
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => resolveBet(bet, "lost")}>
                      Perdeu
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => {
                      const value = prompt("Valor do cashout (R$):");
                      if (value) resolveBet(bet, "cashed_out", parseFloat(value));
                    }}>
                      Cashout
                    </Button>
                  </div>
                )}

                {bet.status !== "open" && (
                  <div className="text-sm pt-2 border-t">
                    <span className="text-muted-foreground">Resultado:</span>{" "}
                    <span className={`font-medium ${
                      bet.result_value > bet.total_stake ? "text-green-500" :
                      bet.result_value < bet.total_stake ? "text-destructive" : ""
                    }`}>
                      {formatCurrency(bet.result_value)} ({formatPercent(((bet.result_value - bet.total_stake) / bet.total_stake) * 100)})
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
