"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangleIcon,
  CheckIcon,
  Loader2Icon,
  SendIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface PendingAction {
  id: string;
  action_type: string;
  payload: Record<string, unknown>;
}

type ChatMode = "real" | "fallback";
type ChatProvider = "anthropic" | "openai" | "fallback";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending_action?: PendingAction;
  action_resolved?: "confirmed" | "cancelled" | "failed";
  action_message?: string;
  /** Quando o pending_action virou bet (confirmado), guarda o id para link. */
  action_bet_id?: string;
}

const STARTER_TIPS = [
  "Explica a pick do Vitória × Flamengo",
  "Monta uma odd 3.00 com esse jogo",
  "Quanto posso apostar hoje?",
  "Salva essa aposta com R$ 50",
  "Me lembra 30 minutos antes do jogo",
  "Estou pensando em colocar mais um jogo",
];

function uid(): string {
  return Math.random().toString(36).slice(2);
}

export default function AnalystPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: uid(),
      role: "assistant",
      content:
        "Oi — sou o **Analista AG IA**. Posso explicar picks, montar combinações, simular registro de aposta (com sua confirmação), criar lembretes e ajudar a manter sua banca em ordem. Como posso ajudar?",
    },
  ]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [mode, setMode] = useState<ChatMode | null>(null);
  const [provider, setProvider] = useState<ChatProvider | null>(null);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    const userMsg: Message = { id: uid(), role: "user", content: trimmed };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setSending(true);
    try {
      const res = await fetch("/api/ai/analyst-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: trimmed }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        const errText =
          json?.error ?? `Erro ${res.status} ao falar com o analista.`;
        setMessages((m) => [
          ...m,
          { id: uid(), role: "assistant", content: errText },
        ]);
        return;
      }
      const data = json.data as {
        session_id: string;
        assistant_text: string;
        pending_action: PendingAction | null;
        mode?: ChatMode;
        provider?: ChatProvider;
        fallback_reason?: string | null;
      };
      setSessionId(data.session_id);
      if (data.mode) setMode(data.mode);
      if (data.provider) setProvider(data.provider);
      setFallbackReason(data.fallback_reason ?? null);
      setMessages((m) => [
        ...m,
        {
          id: uid(),
          role: "assistant",
          content: data.assistant_text,
          pending_action: data.pending_action ?? undefined,
        },
      ]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          id: uid(),
          role: "assistant",
          content: `Erro de rede: ${err instanceof Error ? err.message : "?"}`,
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  async function resolveAction(
    msgId: string,
    actionId: string,
    decision: "confirm" | "cancel"
  ) {
    if (actingId) return;
    setActingId(actionId);
    try {
      const res = await fetch("/api/ai/analyst-chat/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action_id: actionId, decision }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setMessages((m) =>
          m.map((x) =>
            x.id === msgId
              ? {
                  ...x,
                  action_resolved: "failed",
                  action_message: json?.error ?? `Erro ${res.status}`,
                }
              : x
          )
        );
        return;
      }
      const data = json.data as {
        ok: boolean;
        status: string;
        message: string;
        result?: { bet_id?: string } | null;
      };
      const resolved: Message["action_resolved"] =
        decision === "cancel"
          ? "cancelled"
          : data.ok
            ? "confirmed"
            : "failed";
      const betId =
        data.result && typeof data.result.bet_id === "string"
          ? data.result.bet_id
          : undefined;
      setMessages((m) =>
        m.map((x) =>
          x.id === msgId
            ? {
                ...x,
                action_resolved: resolved,
                action_message: data.message,
                action_bet_id: betId,
              }
            : x
        )
      );
    } catch (err) {
      setMessages((m) =>
        m.map((x) =>
          x.id === msgId
            ? {
                ...x,
                action_resolved: "failed",
                action_message:
                  err instanceof Error ? err.message : "Erro de rede",
              }
            : x
        )
      );
    } finally {
      setActingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container max-w-3xl py-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <SparklesIcon className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-semibold">Analista IA</h1>
            <span className="ml-1 inline-flex items-center rounded-full border border-border/60 bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              beta
            </span>
          </div>
          {mode && (
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                mode === "real"
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-yellow-500/40 bg-yellow-500/10 text-yellow-400"
              }`}
            >
              {mode === "real"
                ? `IA real ativa · ${provider ?? "anthropic"}`
                : "Modo fallback ativo"}
            </span>
          )}
        </div>

        {mode === "fallback" && fallbackReason && (
          <div className="mb-3 rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 text-xs text-yellow-300">
            <strong>Modo fallback ativo:</strong> respostas por regras
            determinísticas, IA real não respondeu.
            <span className="ml-1 text-yellow-300/70">({fallbackReason})</span>
          </div>
        )}
        {mode === null && (
          <div className="mb-3 rounded-md border border-border/40 bg-muted/40 p-3 text-xs text-muted-foreground">
            Envie uma pergunta para descobrir se a IA real está ativa.
          </div>
        )}

        <Card className="flex h-[70vh] flex-col">
          <div
            ref={scrollRef}
            className="flex-1 space-y-4 overflow-y-auto p-4"
          >
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  <div className="whitespace-pre-wrap">
                    {renderMarkdownLite(m.content)}
                  </div>

                  {/* Card de ação pendente */}
                  {m.pending_action && (
                    <PendingActionCard
                      action={m.pending_action}
                      resolved={m.action_resolved}
                      message={m.action_message}
                      betId={m.action_bet_id}
                      busy={actingId === m.pending_action.id}
                      onConfirm={() =>
                        resolveAction(m.id, m.pending_action!.id, "confirm")
                      }
                      onCancel={() =>
                        resolveAction(m.id, m.pending_action!.id, "cancel")
                      }
                    />
                  )}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground inline-flex items-center gap-2">
                  <Loader2Icon className="h-3 w-3 animate-spin" />
                  pensando…
                </div>
              </div>
            )}
          </div>

          {/* Sugestões de prompts */}
          <div className="border-t p-3">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {STARTER_TIPS.map((tip) => (
                <button
                  key={tip}
                  type="button"
                  onClick={() => setInput(tip)}
                  className="rounded-full border border-border/60 bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                >
                  {tip}
                </button>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
              className="flex gap-2"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Escreva sua pergunta…"
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                disabled={sending}
                maxLength={1500}
              />
              <Button type="submit" disabled={sending || !input.trim()}>
                <SendIcon className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </Card>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Apoio estatístico — não recomendação financeira. Aposte com responsabilidade.{" "}
          <Link href="/picks" className="underline hover:text-foreground">
            ver Picks de Hoje
          </Link>
        </p>
      </main>
    </div>
  );
}

// ============================================================
// Subcomponentes
// ============================================================

interface BetLegPayload {
  competition?: string;
  home_team?: string;
  away_team?: string;
  market_type?: string;
  selection?: string;
  odd_value?: number;
  player_name?: string | null;
  line?: number | null;
}

interface BetPayload {
  match_name?: string;
  total_stake?: number;
  combined_odd?: number;
  potential_return?: number | null;
  bookmaker?: string | null;
  source_type?: string;
  tier?: string;
  legs?: BetLegPayload[];
}

interface UpdateBetPayload {
  bet_id?: string;
  match_name?: string;
  old_stake?: number;
  old_odd?: number;
  old_potential_return?: number;
  new_stake?: number | null;
  new_odd?: number | null;
  new_potential_return?: number | null;
  stake_delta?: number | null;
  reason?: string | null;
}

function fmtBRL(n: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(n);
}

function BetPreview({ payload }: { payload: BetPayload }) {
  const stake = Number(payload.total_stake) || 0;
  const odd = Number(payload.combined_odd) || 0;
  const declared = payload.potential_return;
  const potentialReturn =
    declared != null && declared > 0 ? Number(declared) : stake * odd;
  const profit = potentialReturn - stake;
  const legs = payload.legs ?? [];
  return (
    <div className="space-y-2 rounded-md border border-border/40 bg-background/40 p-3 text-xs">
      <div className="grid grid-cols-2 gap-2">
        {payload.bookmaker && (
          <Field label="Casa" value={payload.bookmaker} />
        )}
        {payload.match_name && (
          <Field label="Jogo" value={payload.match_name} />
        )}
        <Field label="Stake" value={fmtBRL(stake)} />
        <Field label="Odd combinada" value={odd.toFixed(2)} />
        <Field
          label="Retorno potencial"
          value={fmtBRL(potentialReturn)}
          highlight="text-green-400"
        />
        <Field
          label="Lucro líquido"
          value={fmtBRL(profit)}
          highlight={profit >= 0 ? "text-green-400" : "text-destructive"}
        />
      </div>
      {legs.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Seleções ({legs.length})
          </div>
          <ul className="space-y-1">
            {legs.map((l, i) => {
              const who = l.player_name ?? l.selection ?? "?";
              const market = l.market_type ?? "?";
              return (
                <li key={i} className="leading-snug">
                  <span className="font-medium">{who}</span>
                  <span className="mx-1 text-muted-foreground">—</span>
                  <span>{market}</span>
                  {l.odd_value != null && (
                    <span className="ml-1 text-muted-foreground">
                      @ {Number(l.odd_value).toFixed(2)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {payload.source_type && payload.source_type !== "ai" && (
        <div className="text-[10px] text-muted-foreground">
          origem: {payload.source_type}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: string;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`text-xs font-medium ${highlight ?? ""}`}>{value}</div>
    </div>
  );
}

function UpdateBetPreview({ payload }: { payload: UpdateBetPayload }) {
  const oldStake = Number(payload.old_stake) || 0;
  const oldOdd = Number(payload.old_odd) || 0;
  const oldReturn = Number(payload.old_potential_return) || 0;
  const newStake =
    payload.new_stake != null ? Number(payload.new_stake) : oldStake;
  const newOdd = payload.new_odd != null ? Number(payload.new_odd) : oldOdd;
  const newReturn =
    payload.new_potential_return != null
      ? Number(payload.new_potential_return)
      : Number((newStake * newOdd).toFixed(2));
  const delta = Number(payload.stake_delta ?? newStake - oldStake);
  return (
    <div className="space-y-2 rounded-md border border-border/40 bg-background/40 p-3 text-xs">
      {payload.match_name && (
        <Field label="Aposta" value={payload.match_name} />
      )}
      <div className="grid grid-cols-3 gap-2">
        <DiffField
          label="Stake"
          oldText={fmtBRL(oldStake)}
          newText={fmtBRL(newStake)}
          changed={oldStake !== newStake}
        />
        <DiffField
          label="Odd"
          oldText={oldOdd.toFixed(2)}
          newText={newOdd.toFixed(2)}
          changed={oldOdd !== newOdd}
        />
        <DiffField
          label="Retorno"
          oldText={fmtBRL(oldReturn)}
          newText={fmtBRL(newReturn)}
          changed={oldReturn !== newReturn}
        />
      </div>
      {delta !== 0 && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 px-2 py-1 text-[11px] text-yellow-300">
          Impacto na banca: {delta > 0 ? "−" : "+"}{fmtBRL(Math.abs(delta))}{" "}
          {delta > 0 ? "(saída adicional)" : "(estorno parcial)"}
        </div>
      )}
    </div>
  );
}

function DiffField({
  label,
  oldText,
  newText,
  changed,
}: {
  label: string;
  oldText: string;
  newText: string;
  changed: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {changed ? (
        <div className="text-xs">
          <span className="text-muted-foreground line-through">{oldText}</span>{" "}
          <span className="font-semibold text-primary">→ {newText}</span>
        </div>
      ) : (
        <div className="text-xs font-medium">{newText}</div>
      )}
    </div>
  );
}

function PendingActionCard(props: {
  action: PendingAction;
  resolved?: "confirmed" | "cancelled" | "failed";
  message?: string;
  betId?: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { action, resolved, message, betId, busy, onConfirm, onCancel } = props;
  if (resolved) {
    const cls =
      resolved === "confirmed"
        ? "border-green-500/40 bg-green-500/10 text-green-300"
        : resolved === "cancelled"
          ? "border-border/60 bg-muted text-muted-foreground"
          : "border-destructive/40 bg-destructive/10 text-destructive";
    return (
      <div className={`mt-3 rounded-md border px-3 py-2 text-xs ${cls}`}>
        <div className="font-medium">
          {resolved === "confirmed" && "✓ Ação confirmada"}
          {resolved === "cancelled" && "Ação cancelada"}
          {resolved === "failed" && "✗ Falha ao executar"}
        </div>
        {message && <div className="mt-1 opacity-80">{message}</div>}
        {resolved === "confirmed" && betId && (
          <div className="mt-2">
            <Link
              href={`/bets/${betId}`}
              className="inline-flex items-center gap-1 rounded-md border border-green-500/40 bg-green-500/10 px-2 py-1 text-[11px] font-medium text-green-300 hover:bg-green-500/20"
            >
              Abrir aposta →
            </Link>
          </div>
        )}
      </div>
    );
  }
  const label =
    action.action_type === "create_bet"
      ? "Salvar aposta?"
      : action.action_type === "update_bet"
        ? "Aplicar correção?"
        : action.action_type === "create_reminder"
          ? "Criar lembrete?"
          : `Confirmar ${action.action_type}?`;
  const isBet = action.action_type === "create_bet";
  const isUpdate = action.action_type === "update_bet";
  return (
    <Card className="mt-3 border-primary/40 bg-primary/5">
      <CardContent className="space-y-3 py-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <AlertTriangleIcon className="h-4 w-4 text-primary" />
          {label}
        </div>
        {isBet && <BetPreview payload={action.payload as BetPayload} />}
        {isUpdate && (
          <UpdateBetPreview payload={action.payload as UpdateBetPayload} />
        )}
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={onConfirm}
            disabled={busy}
            className="flex-1"
          >
            {busy ? (
              <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                <CheckIcon className="mr-1 h-3.5 w-3.5" />
                Confirmar
              </>
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onCancel}
            disabled={busy}
            className="flex-1"
          >
            <XIcon className="mr-1 h-3.5 w-3.5" />
            Cancelar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Render markdown-leve: **bold**, _italic_, e links [x](y) viram texto.
 * Sem dependência externa para manter o bundle enxuto.
 */
function renderMarkdownLite(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const tokenRe = /(\*\*[^*]+\*\*|_[^_]+_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      parts.push(
        <strong key={`b-${m.index}`}>{tok.slice(2, -2)}</strong>
      );
    } else if (tok.startsWith("_")) {
      parts.push(<em key={`i-${m.index}`}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
