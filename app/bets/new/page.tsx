"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { calculateEV, calculateCombinedOdd, calculateCombinedProb, suggestTier, checkFramework } from "@/lib/utils/framework";
import { Trash2, Plus } from "lucide-react";
import Link from "next/link";

interface Leg {
  competition: string;
  home_team: string;
  away_team: string;
  market_type: string;
  selection: string;
  odd_value: number;
  estimated_prob_pct: number;
}

const EMPTY_LEG: Leg = {
  competition: "", home_team: "", away_team: "",
  market_type: "", selection: "", odd_value: 1.5, estimated_prob_pct: 70,
};

export default function NewBetPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [legs, setLegs] = useState<Leg[]>([{ ...EMPTY_LEG }]);
  const [stake, setStake] = useState(50);
  const [bookmaker, setBookmaker] = useState("");
  const [notes, setNotes] = useState("");

  const [check, setCheck] = useState<any>(null);

  const combinedOdd = calculateCombinedOdd(legs.map(l => l.odd_value));
  const combinedProb = calculateCombinedProb(legs.map(l => l.estimated_prob_pct));
  const ev = calculateEV(combinedProb, combinedOdd);
  const potentialReturn = stake * combinedOdd;
  const profit = potentialReturn - stake;
  const tier = suggestTier(combinedProb);
  const betType = legs.length === 1 ? "single" : "multiple";

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [{ data: br }, { data: fw }] = await Promise.all([
        supabase.from("bankroll").select("*").eq("user_id", user.id).single(),
        supabase.from("framework_settings").select("*").eq("user_id", user.id).single(),
      ]);

      const today = new Date().toISOString().split("T")[0];
      const { data: todayBets } = await supabase
        .from("bets")
        .select("total_stake, result_value, status")
        .eq("user_id", user.id)
        .gte("placed_at", `${today}T00:00:00`);

      const todayStaked = (todayBets ?? []).reduce((acc, b) => acc + Number(b.total_stake), 0);
      const todayPnl = (todayBets ?? []).reduce((acc, b) => {
        if (b.status === "won" || b.status === "lost" || b.status === "cashed_out") {
          return acc + (Number(b.result_value) - Number(b.total_stake));
        }
        return acc;
      }, 0);

      if (br && fw) {
        const c = checkFramework(br, fw, stake, {
          staked: todayStaked,
          pnl: todayPnl,
          bets_count: todayBets?.length ?? 0,
        });
        setCheck(c);
      }
      setLoading(false);
    }
    load();
  }, [supabase, stake]);

  function updateLeg(i: number, field: keyof Leg, value: any) {
    const copy = [...legs];
    copy[i] = { ...copy[i], [field]: value };
    setLegs(copy);
  }

  function addLeg() {
    if (legs.length >= 10) return;
    setLegs([...legs, { ...EMPTY_LEG }]);
  }

  function removeLeg(i: number) {
    if (legs.length === 1) return;
    setLegs(legs.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (check && !check.can_bet) {
      setError(check.reason);
      return;
    }

    for (const leg of legs) {
      if (!leg.competition || !leg.home_team || !leg.away_team || !leg.market_type || !leg.selection) {
        setError("Preencha todos os campos das pernas.");
        return;
      }
    }

    setSubmitting(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Inserir aposta
    const { data: bet, error: betError } = await supabase
      .from("bets")
      .insert({
        user_id: user.id,
        bet_type: betType,
        tier,
        total_stake: stake,
        combined_odd: combinedOdd,
        potential_return: potentialReturn,
        estimated_prob_pct: combinedProb,
        estimated_ev_pct: ev,
        bookmaker: bookmaker || null,
        notes: notes || null,
        status: "open",
        followed_framework: check?.can_bet ?? true,
      })
      .select()
      .single();

    if (betError || !bet) {
      setError("Erro ao salvar aposta: " + betError?.message);
      setSubmitting(false);
      return;
    }

    // Inserir legs
    const legsToInsert = legs.map((l, i) => ({
      bet_id: bet.id,
      competition: l.competition,
      home_team: l.home_team,
      away_team: l.away_team,
      market_type: l.market_type,
      selection: l.selection,
      odd_value: l.odd_value,
      estimated_prob_pct: l.estimated_prob_pct,
      position: i + 1,
    }));

    const { error: legsError } = await supabase.from("bet_legs").insert(legsToInsert);
    if (legsError) {
      setError("Erro ao salvar pernas: " + legsError.message);
      setSubmitting(false);
      return;
    }

    // Atualizar bankroll e log
    const { data: br } = await supabase.from("bankroll").select("*").eq("user_id", user.id).single();
    if (br) {
      const newBalance = Number(br.current_balance) - stake;
      const newTotalStaked = Number(br.total_staked) + stake;
      await supabase.from("bankroll").update({
        current_balance: newBalance,
        total_staked: newTotalStaked,
      }).eq("user_id", user.id);
      await supabase.from("bankroll_log").insert({
        user_id: user.id,
        type: "bet_placed",
        amount: -stake,
        balance_after: newBalance,
        description: `[bet:${bet.id}] Aposta registrada — ${betType} ${legs.length} perna(s)`,
      });
    }

    router.push("/dashboard");
    router.refresh();
  }

  if (loading) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <main className="container py-8">Carregando...</main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="container py-8 max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Nova Aposta</h1>
          <p className="text-muted-foreground">Registre uma aposta single ou múltipla</p>
        </div>

        {check && !check.can_bet && (
          <Card className="border-destructive">
            <CardContent className="py-4">
              <p className="text-sm text-destructive font-medium">⚠️ {check.reason}</p>
            </CardContent>
          </Card>
        )}
        {check?.warnings?.length > 0 && (
          <Card className="border-yellow-500">
            <CardContent className="py-4 space-y-1">
              {check.warnings.map((w: string, i: number) => (
                <p key={i} className="text-sm">{w}</p>
              ))}
            </CardContent>
          </Card>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Pernas */}
          <div className="space-y-4">
            {legs.map((leg, i) => (
              <Card key={i}>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-lg">Perna {i + 1}</CardTitle>
                  {legs.length > 1 && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeLeg(i)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Competição</Label>
                      <Input
                        placeholder="Brasileirão"
                        value={leg.competition}
                        onChange={(e) => updateLeg(i, "competition", e.target.value)}
                      />
                    </div>
                    <div>
                      <Label>Casa Aposta</Label>
                      <Input placeholder="Bet365" value={bookmaker} onChange={(e) => setBookmaker(e.target.value)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Mandante</Label>
                      <Input value={leg.home_team} onChange={(e) => updateLeg(i, "home_team", e.target.value)} />
                    </div>
                    <div>
                      <Label>Visitante</Label>
                      <Input value={leg.away_team} onChange={(e) => updateLeg(i, "away_team", e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <Label>Mercado</Label>
                    <Input placeholder="Mais de 2.5 gols" value={leg.market_type} onChange={(e) => updateLeg(i, "market_type", e.target.value)} />
                  </div>
                  <div>
                    <Label>Seleção</Label>
                    <Input placeholder="Sim" value={leg.selection} onChange={(e) => updateLeg(i, "selection", e.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Odd</Label>
                      <Input
                        type="number" step="0.01" min="1.01"
                        value={leg.odd_value}
                        onChange={(e) => updateLeg(i, "odd_value", parseFloat(e.target.value) || 1.01)}
                      />
                    </div>
                    <div>
                      <Label>Prob. estimada (%)</Label>
                      <Input
                        type="number" step="1" min="1" max="99"
                        value={leg.estimated_prob_pct}
                        onChange={(e) => updateLeg(i, "estimated_prob_pct", parseInt(e.target.value) || 50)}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Button type="button" variant="outline" onClick={addLeg} disabled={legs.length >= 10} className="w-full">
            <Plus className="h-4 w-4 mr-2" />
            Adicionar Perna ({legs.length}/10)
          </Button>

          {/* Stake e cálculos */}
          <Card>
            <CardHeader>
              <CardTitle>Stake e Análise</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Stake (R$)</Label>
                <Input type="number" step="0.01" min="0.01" value={stake} onChange={(e) => setStake(parseFloat(e.target.value) || 0)} />
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Odd combinada</p>
                  <p className="text-lg font-bold">{combinedOdd.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Probabilidade real</p>
                  <p className="text-lg font-bold">{combinedProb.toFixed(1)}%</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Retorno potencial</p>
                  <p className="text-lg font-bold text-green-500">{formatCurrency(potentialReturn)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Lucro líquido</p>
                  <p className="text-lg font-bold">{formatCurrency(profit)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">EV%</p>
                  <p className={`text-lg font-bold ${ev >= 0 ? "text-green-500" : "text-destructive"}`}>
                    {formatPercent(ev)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Tier sugerido</p>
                  <p className="text-lg font-bold uppercase">{tier.replace("_", " ")}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div>
            <Label>Observações (opcional)</Label>
            <Input placeholder="Análise, raciocínio..." value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-3">
            <Button type="submit" className="flex-1" disabled={submitting || (check && !check.can_bet)}>
              {submitting ? "Registrando..." : "Registrar Aposta"}
            </Button>
            <Button asChild type="button" variant="outline" className="flex-1">
              <Link href="/dashboard">Cancelar</Link>
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}
