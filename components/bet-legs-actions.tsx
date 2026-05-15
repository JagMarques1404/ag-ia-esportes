"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CheckIcon, Loader2Icon, MinusIcon, XIcon } from "lucide-react";

export type LegStatus = "pending" | "won" | "lost" | "void";

export interface LegRow {
  id: string;
  bet_id: string;
  competition: string | null;
  home_team: string | null;
  away_team: string | null;
  market_type: string | null;
  selection: string | null;
  odd_value: number | null;
  player_name?: string | null;
  line?: number | null;
  actual_value?: string | null;
  notes?: string | null;
  result: LegStatus | string | null;
  position: number | null;
}

interface SettleResponse {
  ok: boolean;
  data?: {
    bet_id: string;
    bet_status: "open" | "won" | "lost" | "void" | "partial";
    bet_settled_now: boolean;
    credited_amount: number;
    balance_after: number;
    legs_summary: {
      total: number;
      won: number;
      lost: number;
      void: number;
      pending: number;
    };
  };
  error?: string;
}

interface Props {
  betId: string;
  initialLegs: LegRow[];
  /** Status inicial do bet — desabilita botões quando não é open/partial. */
  initialBetStatus: string;
}

export function BetLegsActions({ betId, initialLegs, initialBetStatus }: Props) {
  const router = useRouter();
  const [legs, setLegs] = useState<LegRow[]>(initialLegs);
  const [betStatus, setBetStatus] = useState<string>(initialBetStatus);
  const [busyLegId, setBusyLegId] = useState<string | null>(null);
  const [lastFlash, setLastFlash] = useState<{
    legId: string;
    text: string;
    kind: "ok" | "err";
  } | null>(null);

  const summary = useMemo(() => {
    const s = { total: legs.length, won: 0, lost: 0, void: 0, pending: 0 };
    for (const l of legs) {
      const r = (l.result ?? "pending") as string;
      if (r === "won" || r === "half_won") s.won++;
      else if (r === "lost" || r === "half_lost") s.lost++;
      else if (r === "void") s.void++;
      else s.pending++;
    }
    return s;
  }, [legs]);

  const isFinalized = betStatus !== "open" && betStatus !== "partial";

  async function settleLeg(legId: string, result: LegStatus) {
    if (busyLegId || isFinalized) return;
    setBusyLegId(legId);
    setLastFlash(null);
    try {
      const res = await fetch(`/api/bets/${betId}/settle-leg`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ legId, result }),
      });
      const json = (await res.json()) as SettleResponse;
      if (!res.ok || !json.ok || !json.data) {
        setLastFlash({
          legId,
          text: json.error ?? `Erro ${res.status}`,
          kind: "err",
        });
        return;
      }
      // Atualiza UI local
      setLegs((prev) =>
        prev.map((l) => (l.id === legId ? { ...l, result } : l))
      );
      setBetStatus(json.data.bet_status);
      const flashText = json.data.bet_settled_now
        ? `✓ Aposta liquidada (${json.data.bet_status}) · banca: R$ ${json.data.balance_after.toFixed(
            2
          )}${
            json.data.credited_amount > 0
              ? ` (+R$ ${json.data.credited_amount.toFixed(2)})`
              : ""
          }`
        : `✓ Leg marcada (${result})`;
      setLastFlash({ legId, text: flashText, kind: "ok" });
      // Re-fetch dados server-side (atualiza header da página, banca etc.)
      router.refresh();
    } catch (err) {
      setLastFlash({
        legId,
        text: err instanceof Error ? err.message : "Erro de rede",
        kind: "err",
      });
    } finally {
      setBusyLegId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <Pill label="Total" value={summary.total} />
        <Pill label="Green" value={summary.won} className="text-green-400" />
        <Pill label="Red" value={summary.lost} className="text-destructive" />
        <Pill label="Void" value={summary.void} />
        <Pill
          label="Pendentes"
          value={summary.pending}
          className="text-yellow-400"
        />
      </div>

      {legs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma perna registrada nesta aposta.
        </p>
      ) : (
        <div className="space-y-3">
          {legs.map((l) => {
            const isBusy = busyLegId === l.id;
            const r = (l.result ?? "pending") as LegStatus;
            const flash = lastFlash?.legId === l.id ? lastFlash : null;
            return (
              <div
                key={l.id}
                className="rounded-md border border-border/40 bg-muted/40 p-3 text-sm space-y-2"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="font-medium">
                    {l.player_name ??
                      l.selection ??
                      `${l.home_team ?? "?"} × ${l.away_team ?? "?"}`}
                  </div>
                  {l.odd_value != null && (
                    <div className="text-xs text-muted-foreground">
                      Odd:{" "}
                      <span className="font-medium">
                        {Number(l.odd_value).toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>
                <div className="text-sm">
                  {l.market_type ?? "?"}
                  {l.line != null && (
                    <span className="text-muted-foreground"> (line {Number(l.line).toFixed(1)})</span>
                  )}
                </div>
                {l.competition && (
                  <div className="text-xs text-muted-foreground">
                    {l.competition}
                  </div>
                )}

                {/* Status atual */}
                <div className="flex items-center gap-2">
                  <StatusBadge result={r} />
                  {l.actual_value && (
                    <span className="text-xs text-muted-foreground">
                      atual: {l.actual_value}
                    </span>
                  )}
                </div>

                {/* Botões */}
                {!isFinalized && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      size="sm"
                      variant={r === "won" ? "default" : "outline"}
                      disabled={isBusy}
                      onClick={() => settleLeg(l.id, "won")}
                      className={
                        r === "won"
                          ? "bg-green-600 hover:bg-green-700 text-white"
                          : "text-green-400 hover:text-green-300"
                      }
                    >
                      {isBusy ? (
                        <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <>
                          <CheckIcon className="mr-1 h-3.5 w-3.5" />
                          Green
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant={r === "lost" ? "default" : "outline"}
                      disabled={isBusy}
                      onClick={() => settleLeg(l.id, "lost")}
                      className={
                        r === "lost"
                          ? "bg-destructive hover:bg-destructive/90 text-white"
                          : "text-destructive hover:text-destructive/80"
                      }
                    >
                      {isBusy ? (
                        <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <>
                          <XIcon className="mr-1 h-3.5 w-3.5" />
                          Red
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant={r === "void" ? "default" : "outline"}
                      disabled={isBusy}
                      onClick={() => settleLeg(l.id, "void")}
                    >
                      {isBusy ? (
                        <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <>
                          <MinusIcon className="mr-1 h-3.5 w-3.5" />
                          Void
                        </>
                      )}
                    </Button>
                    {r !== "pending" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isBusy}
                        onClick={() => settleLeg(l.id, "pending")}
                        className="text-xs text-muted-foreground"
                      >
                        Reverter
                      </Button>
                    )}
                  </div>
                )}

                {flash && (
                  <div
                    className={`text-xs rounded-md border px-2 py-1 ${
                      flash.kind === "ok"
                        ? "border-green-500/30 bg-green-500/5 text-green-300"
                        : "border-destructive/40 bg-destructive/10 text-destructive"
                    }`}
                  >
                    {flash.text}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {isFinalized && (
        <div className="rounded-md border border-border/40 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Aposta finalizada como <strong>{betStatus}</strong>. Edição de legs bloqueada.
        </div>
      )}
    </div>
  );
}

function Pill({
  label,
  value,
  className,
}: {
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <div
      className={`inline-flex items-baseline gap-1 rounded-md border border-border/40 bg-background/40 px-2 py-1 ${className ?? ""}`}
    >
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function StatusBadge({ result }: { result: LegStatus }) {
  const STYLES: Record<LegStatus, string> = {
    pending: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
    won: "bg-green-500/15 text-green-300 border-green-500/30",
    lost: "bg-destructive/15 text-destructive border-destructive/30",
    void: "bg-muted text-muted-foreground border-border/40",
  };
  const LABEL: Record<LegStatus, string> = {
    pending: "pendente",
    won: "green",
    lost: "red",
    void: "void",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase ${STYLES[result]}`}
    >
      {LABEL[result]}
    </span>
  );
}
