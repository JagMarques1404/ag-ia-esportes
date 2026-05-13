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
import { formatCurrency } from "@/lib/utils";

export default function SettingsPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const [balance, setBalance] = useState(0);
  const [maxStakePct, setMaxStakePct] = useState(5);
  const [dailyLimitPct, setDailyLimitPct] = useState(12);
  const [stopLossPct, setStopLossPct] = useState(10);
  const [stopWinPct, setStopWinPct] = useState(25);
  const [maxBetsPerDay, setMaxBetsPerDay] = useState(5);
  const [protectionMode, setProtectionMode] = useState<"normal" | "strict" | "paused">("normal");

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: br } = await supabase.from("bankroll").select("*").eq("user_id", user.id).single();
      const { data: fw } = await supabase.from("framework_settings").select("*").eq("user_id", user.id).single();
      if (br) setBalance(br.current_balance);
      if (fw) {
        setMaxStakePct(fw.max_stake_pct);
        setDailyLimitPct(fw.daily_limit_pct);
        setStopLossPct(fw.stop_loss_pct);
        setStopWinPct(fw.stop_win_pct);
        setMaxBetsPerDay(fw.max_bets_per_day);
        setProtectionMode(fw.protection_mode);
      }
      setLoading(false);
    }
    load();
  }, [supabase]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg("");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: existing } = await supabase.from("bankroll").select("starting_balance, current_balance").eq("user_id", user.id).single();
    const isInitial = !existing || existing.starting_balance === 0;

    const updates: Record<string, number> = { current_balance: balance };
    if (isInitial) updates.starting_balance = balance;

    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from("bankroll").update(updates).eq("user_id", user.id),
      supabase.from("framework_settings").update({
        max_stake_pct: maxStakePct,
        daily_limit_pct: dailyLimitPct,
        stop_loss_pct: stopLossPct,
        stop_win_pct: stopWinPct,
        max_bets_per_day: maxBetsPerDay,
        protection_mode: protectionMode,
      }).eq("user_id", user.id),
    ]);

    if (e1 || e2) {
      setMsg("Erro ao salvar: " + (e1?.message || e2?.message));
    } else {
      setMsg("Configurações salvas com sucesso.");
      setTimeout(() => router.push("/dashboard"), 1500);
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <main className="container py-8">Carregando...</main>
      </div>
    );
  }

  const maxStakeValue = balance * (maxStakePct / 100);
  const dailyLimitValue = balance * (dailyLimitPct / 100);
  const stopLossValue = balance * (stopLossPct / 100);
  const stopWinValue = balance * (stopWinPct / 100);

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="container py-8 max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Configurações</h1>
          <p className="text-muted-foreground">Banca e regras de gestão</p>
        </div>

        <form onSubmit={handleSave} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Banca</CardTitle>
              <CardDescription>Saldo atual disponível para apostas</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label>Saldo atual (R$)</Label>
                <Input
                  type="number" step="0.01" min="0" value={balance}
                  onChange={(e) => setBalance(parseFloat(e.target.value) || 0)}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Limites de Stake</CardTitle>
              <CardDescription>Quanto pode apostar por bilhete e por dia</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Stake máximo por aposta: {maxStakePct}% ({formatCurrency(maxStakeValue)})</Label>
                <Input type="range" min="1" max="20" value={maxStakePct} onChange={(e) => setMaxStakePct(parseInt(e.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>Limite diário total: {dailyLimitPct}% ({formatCurrency(dailyLimitValue)})</Label>
                <Input type="range" min="3" max="30" value={dailyLimitPct} onChange={(e) => setDailyLimitPct(parseInt(e.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>Máximo de apostas por dia: {maxBetsPerDay}</Label>
                <Input type="range" min="3" max="15" value={maxBetsPerDay} onChange={(e) => setMaxBetsPerDay(parseInt(e.target.value))} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Stop-Loss e Stop-Win</CardTitle>
              <CardDescription>Limites diários de perda e ganho</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Stop-Loss diário: -{stopLossPct}% ({formatCurrency(stopLossValue)})</Label>
                <Input type="range" min="5" max="25" value={stopLossPct} onChange={(e) => setStopLossPct(parseInt(e.target.value))} />
                <p className="text-xs text-muted-foreground">Quando atingido, apostas bloqueadas por 24h.</p>
              </div>
              <div className="space-y-2">
                <Label>Stop-Win diário: +{stopWinPct}% ({formatCurrency(stopWinValue)})</Label>
                <Input type="range" min="10" max="50" value={stopWinPct} onChange={(e) => setStopWinPct(parseInt(e.target.value))} />
                <p className="text-xs text-muted-foreground">Quando atingido, sistema sugere sacar e parar.</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Modo de Proteção</CardTitle>
              <CardDescription>Nível de rigor do framework</CardDescription>
            </CardHeader>
            <CardContent>
              <Select value={protectionMode} onValueChange={(v) => setProtectionMode(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal — permite ultrapassar com aviso</SelectItem>
                  <SelectItem value="strict">Estrito — bloqueia ao ultrapassar limite</SelectItem>
                  <SelectItem value="paused">Pausado — bloqueia todas as apostas</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {msg && <p className="text-sm">{msg}</p>}
          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? "Salvando..." : "Salvar configurações"}
          </Button>
        </form>
      </main>
    </div>
  );
}
