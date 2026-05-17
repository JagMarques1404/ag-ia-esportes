"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClipboardPasteIcon, Loader2Icon } from "lucide-react";

interface ExternalLineupResult {
  save: {
    external_source_id: string;
    inserted_players: number;
    matched_real: number;
    matched_no_history: number;
    synthetic_fallback: number;
    ambiguous: number;
    unresolved: Array<{ name: string; team: string }>;
    warnings: string[];
  };
  board: {
    readiness: string;
    lineup_count: number;
    players_with_history: number;
    sample3_count: number;
    dq_avg: number;
    strong_count: number;
    picks_drafted: number;
    blocked_reason: string | null;
  } | null;
}

interface ApiResponse {
  ok: boolean;
  data?: ExternalLineupResult;
  error?: string;
}

const SAMPLE_TEXT = `Athletico-PR (4-2-3-1): Bento; Madson, Belezi, Pedro Henrique, Esquivel; Erick, Christian; Cuello, Canobbio, Fernandinho; Pablo
Flamengo (4-3-3): Rossi; Wesley, Léo Pereira, Léo Ortiz, Ayrton Lucas; Pulgar, Allan, De La Cruz; Bruno Henrique, Pedro, Arrascaeta`;

export function ExternalLineupForm({ apiFixtureId }: { apiFixtureId: number }) {
  const router = useRouter();
  const [sourceName, setSourceName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceType, setSourceType] = useState<"predicted" | "confirmed">(
    "predicted"
  );
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExternalLineupResult | null>(null);

  async function submit() {
    setError(null);
    if (!sourceName.trim()) {
      setError("Informe a fonte (ex.: FutStats, FotMob, boletim do clube).");
      return;
    }
    if (text.trim().length < 10) {
      setError("Cole o texto da escalação.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/studio/external-lineup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiFixtureId,
          sourceName: sourceName.trim(),
          sourceUrl: sourceUrl.trim() || null,
          sourceType,
          text,
          generateBoard: true,
        }),
      });
      const json = (await res.json()) as ApiResponse;
      if (!res.ok || !json.ok || !json.data) {
        setError(json.error ?? `Erro ${res.status}`);
        return;
      }
      setResult(json.data);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro de rede");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardPasteIcon className="h-4 w-4 text-primary" />
          Adicionar escalação provável/confirmada
        </CardTitle>
        <CardDescription>
          Cole de FutStats / FotMob / SofaScore / Flashscore / boletim do
          clube quando a API-Football não retornar lineup.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="src-name">Fonte</Label>
            <Input
              id="src-name"
              value={sourceName}
              onChange={(e) => setSourceName(e.target.value)}
              placeholder="FutStats / FotMob / boletim..."
              maxLength={60}
            />
          </div>
          <div>
            <Label htmlFor="src-url">URL (opcional)</Label>
            <Input
              id="src-url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>
        </div>
        <div>
          <Label>Tipo</Label>
          <Select
            value={sourceType}
            onValueChange={(v: "predicted" | "confirmed") => setSourceType(v)}
          >
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="predicted">Provável (preview)</SelectItem>
              <SelectItem value="confirmed">Confirmada (oficial)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="lineup-text">Escalação (cole o texto)</Label>
          <textarea
            id="lineup-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={SAMPLE_TEXT}
            className="mt-1 min-h-[200px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Formato sugerido:{" "}
            <code>TimeA (4-2-3-1): Goleiro; Z1, Z2, Z3, Z4; ...</code>
          </p>
        </div>
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        <Button onClick={submit} disabled={loading} className="w-full">
          {loading ? (
            <>
              <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
              Processando escalação + board...
            </>
          ) : (
            "Salvar escalação e gerar análise"
          )}
        </Button>

        {result && (
          <div className="space-y-2 rounded-md border border-border/40 bg-background/40 p-3 text-xs">
            <div className="font-medium">Resultado</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat label="Inseridos" value={String(result.save.inserted_players)} />
              <Stat
                label="Real + histórico"
                value={String(result.save.matched_real)}
                cls="text-green-400"
              />
              <Stat
                label="Real s/ hist"
                value={String(result.save.matched_no_history)}
                cls="text-yellow-400"
              />
              <Stat
                label="Sintéticos"
                value={String(result.save.synthetic_fallback)}
                cls="text-orange-400"
              />
              <Stat
                label="Ambíguos"
                value={String(result.save.ambiguous)}
                cls="text-yellow-400"
              />
              <Stat
                label="Não resolvidos"
                value={String(result.save.unresolved.length)}
                cls="text-destructive"
              />
            </div>

            {result.board && (
              <div className="mt-3 border-t border-border/40 pt-3">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Board gerado
                </div>
                <div className="flex flex-wrap gap-3">
                  <Stat
                    label="readiness"
                    value={result.board.readiness}
                    cls={
                      result.board.readiness === "READY"
                        ? "text-green-400"
                        : result.board.readiness === "WATCHLIST"
                          ? "text-yellow-400"
                          : "text-destructive"
                    }
                  />
                  <Stat label="sample3+" value={String(result.board.sample3_count)} />
                  <Stat label="dq" value={result.board.dq_avg.toFixed(2)} />
                  <Stat label="strong" value={String(result.board.strong_count)} />
                  <Stat
                    label="picks draft"
                    value={String(result.board.picks_drafted)}
                    cls="text-primary"
                  />
                </div>
                {result.board.blocked_reason && (
                  <div className="mt-2 text-[11px] text-destructive">
                    Motivo: {result.board.blocked_reason}
                  </div>
                )}
              </div>
            )}

            {result.save.unresolved.length > 0 && (
              <details className="text-[11px]">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  Jogadores não resolvidos ({result.save.unresolved.length})
                </summary>
                <ul className="mt-2 space-y-0.5 text-muted-foreground">
                  {result.save.unresolved.slice(0, 30).map((u, i) => (
                    <li key={i}>
                      {u.name} <span className="text-[10px]">({u.team})</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {result.save.warnings.length > 0 && (
              <details className="text-[11px]">
                <summary className="cursor-pointer text-yellow-400 hover:text-yellow-300">
                  Avisos ({result.save.warnings.length})
                </summary>
                <ul className="mt-2 space-y-0.5 text-muted-foreground">
                  {result.save.warnings.slice(0, 10).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {sourceType === "predicted" && (
          <p className="text-[10px] text-yellow-400">
            ⚠ Escalação provável (preview). Confirmar antes de apostar.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  cls,
}: {
  label: string;
  value: string;
  cls?: string;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`text-sm font-semibold ${cls ?? ""}`}>{value}</div>
    </div>
  );
}
