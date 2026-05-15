"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type LegStatus = "pending" | "green" | "red" | "void";

interface LegInput {
  id?: string;
  position: number;
  player_name: string;
  market: string;
  line: string;
  odd: string;
  actual_value: string;
  result_status: LegStatus;
  result_notes: string;
}

function toLegInput(l: {
  id?: string;
  position: number;
  player_name: string;
  market: string;
  line: number | null;
  odd?: number | null;
  actual_value: string | null;
  result_status: LegStatus;
  result_notes: string | null;
}): LegInput {
  return {
    id: l.id,
    position: l.position,
    player_name: l.player_name,
    market: l.market,
    line: l.line == null ? "" : String(l.line),
    odd: l.odd == null ? "" : String(l.odd),
    actual_value: l.actual_value ?? "",
    result_status: l.result_status,
    result_notes: l.result_notes ?? "",
  };
}

export function SettleForm(props: {
  pickId: string;
  existingLegs: Array<{
    id: string;
    position: number;
    player_name: string;
    market: string;
    line: number | null;
    odd: number | null;
    actual_value: string | null;
    result_status: LegStatus;
    result_notes: string | null;
  }>;
  marketsFallback: Array<{
    id: string;
    position: number;
    player_name: string;
    market: string;
    line: number | null;
    actual_value: string | null;
    result_status: LegStatus;
    result_notes: string | null;
  }>;
}) {
  const { pickId, existingLegs, marketsFallback } = props;
  const router = useRouter();
  const [legs, setLegs] = useState<LegInput[]>(() =>
    existingLegs.length > 0 ? existingLegs.map(toLegInput) : []
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null
  );

  const summary = useMemo(() => {
    const greens = legs.filter((l) => l.result_status === "green").length;
    const reds = legs.filter((l) => l.result_status === "red").length;
    const voids = legs.filter((l) => l.result_status === "void").length;
    const pendings = legs.filter((l) => l.result_status === "pending").length;
    const total = legs.length;
    let projected = "—";
    if (total > 0) {
      if (pendings > 0) projected = "published (pendente)";
      else if (reds > 0) projected = "red";
      else if (greens > 0 && voids === 0) projected = "green";
      else if (greens > 0 && voids > 0) projected = "green (com void parcial)";
      else if (voids === total) projected = "void";
    }
    return { greens, reds, voids, pendings, total, projected };
  }, [legs]);

  function genFromMarkets() {
    if (legs.length > 0) {
      const yes = confirm(
        "Já existem pernas no formulário. Substituir pelas markets do pick?"
      );
      if (!yes) return;
    }
    setLegs(marketsFallback.map(toLegInput));
  }

  function update(idx: number, patch: Partial<LegInput>) {
    setLegs((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, ...patch } : l))
    );
  }
  function remove(idx: number) {
    setLegs((prev) =>
      prev
        .filter((_, i) => i !== idx)
        .map((l, i) => ({ ...l, position: i + 1 }))
    );
  }
  function addEmpty() {
    setLegs((prev) => [
      ...prev,
      {
        position: prev.length + 1,
        player_name: "",
        market: "",
        line: "",
        odd: "",
        actual_value: "",
        result_status: "pending",
        result_notes: "",
      },
    ]);
  }

  async function handleSubmit() {
    setBusy(true);
    setMsg(null);
    try {
      const payload = {
        legs: legs.map((l, i) => ({
          position: i + 1,
          player_name: l.player_name.trim(),
          market: l.market.trim(),
          line: l.line.trim() === "" ? null : Number(l.line.replace(",", ".")),
          odd: l.odd.trim() === "" ? null : Number(l.odd.replace(",", ".")),
          actual_value:
            l.actual_value.trim() === "" ? null : l.actual_value.trim(),
          result_status: l.result_status,
          result_notes:
            l.result_notes.trim() === "" ? null : l.result_notes.trim(),
        })),
      };
      const invalid = payload.legs.find(
        (l) => !l.player_name || !l.market
      );
      if (invalid) {
        throw new Error("Cada perna precisa de jogador e mercado.");
      }
      const res = await fetch(`/api/admin/picks/${pickId}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json?.error ?? `Erro ${res.status}`);
      }
      const data = json.data as {
        new_status: string;
        new_notes: string | null;
        legs_count: number;
      };
      setMsg({
        kind: "ok",
        text: `Salvo. Status do pick: ${data.new_status}. ${data.new_notes ?? ""}`,
      });
      // Recarregar a tela para refletir as legs persistidas com IDs reais.
      router.refresh();
    } catch (err) {
      setMsg({
        kind: "err",
        text: err instanceof Error ? err.message : "Erro desconhecido",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm">
          <div>
            <span className="text-muted-foreground">Pernas:</span>{" "}
            <span className="font-medium">{summary.total}</span>
            {" · "}
            <span className="text-green-400">{summary.greens} green</span>
            {" / "}
            <span className="text-destructive">{summary.reds} red</span>
            {" / "}
            <span className="text-muted-foreground">{summary.voids} void</span>
            {summary.pendings > 0 && (
              <>
                {" · "}
                <span>{summary.pendings} pend.</span>
              </>
            )}
          </div>
          <div>
            <span className="text-muted-foreground">Status projetado:</span>{" "}
            <span className="font-semibold">{summary.projected}</span>
          </div>
        </CardContent>
      </Card>

      {legs.length === 0 && (
        <Card>
          <CardContent className="space-y-3 py-6 text-sm">
            <p>
              Nenhuma perna criada ainda. Você pode gerar a partir de
              <code className="mx-1 rounded bg-muted px-1">public_picks.markets</code>
              ou adicionar manualmente.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={genFromMarkets} disabled={marketsFallback.length === 0}>
                Gerar pernas a partir dos markets ({marketsFallback.length})
              </Button>
              <Button variant="outline" onClick={addEmpty}>
                <PlusIcon className="mr-1 h-3.5 w-3.5" />
                Adicionar perna vazia
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {legs.map((leg, idx) => (
        <Card key={leg.id ?? `new-${idx}`}>
          <CardContent className="space-y-3 py-4">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Perna {idx + 1}
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => remove(idx)}
                disabled={busy}
              >
                <Trash2Icon className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Jogador</Label>
                <Input
                  value={leg.player_name}
                  onChange={(e) =>
                    update(idx, { player_name: e.target.value })
                  }
                  placeholder="Bruno Henrique"
                />
              </div>
              <div className="space-y-1">
                <Label>Mercado</Label>
                <Input
                  value={leg.market}
                  onChange={(e) => update(idx, { market: e.target.value })}
                  placeholder="+2.5 finalizações"
                />
              </div>
              <div className="space-y-1">
                <Label>Linha (opcional)</Label>
                <Input
                  inputMode="decimal"
                  value={leg.line}
                  onChange={(e) => update(idx, { line: e.target.value })}
                  placeholder="2.5"
                />
              </div>
              <div className="space-y-1">
                <Label>Odd (opcional)</Label>
                <Input
                  inputMode="decimal"
                  value={leg.odd}
                  onChange={(e) => update(idx, { odd: e.target.value })}
                  placeholder="1.85"
                />
              </div>
              <div className="space-y-1">
                <Label>Valor observado (fez X / observado)</Label>
                <Input
                  value={leg.actual_value}
                  onChange={(e) =>
                    update(idx, { actual_value: e.target.value })
                  }
                  placeholder="4 finalizações"
                />
              </div>
              <div className="space-y-1">
                <Label>Resultado</Label>
                <Select
                  value={leg.result_status}
                  onValueChange={(v) =>
                    update(idx, { result_status: v as LegStatus })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pendente</SelectItem>
                    <SelectItem value="green">Green</SelectItem>
                    <SelectItem value="red">Red</SelectItem>
                    <SelectItem value="void">Void</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Notas</Label>
              <Input
                value={leg.result_notes}
                onChange={(e) =>
                  update(idx, { result_notes: e.target.value })
                }
                placeholder="Saiu no 2T, fez 4 finalizações."
              />
            </div>
          </CardContent>
        </Card>
      ))}

      {legs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={addEmpty} disabled={busy}>
            <PlusIcon className="mr-1 h-3.5 w-3.5" />
            Adicionar perna
          </Button>
          <div className="ml-auto" />
          <Button onClick={handleSubmit} disabled={busy}>
            {busy ? (
              <Loader2Icon className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : null}
            Salvar resultados
          </Button>
        </div>
      )}

      {msg && (
        <div
          className={`rounded-md border p-3 text-sm ${
            msg.kind === "ok"
              ? "border-green-500/40 bg-green-500/10 text-green-300"
              : "border-destructive/40 bg-destructive/10 text-destructive"
          }`}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}
