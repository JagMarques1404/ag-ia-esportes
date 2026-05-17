"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2Icon, SparklesIcon } from "lucide-react";

interface UpcomingLeg {
  player_name: string;
  market: string;
  line: number;
  probability: number;
  sample_size: number;
  hit_rate: number | null;
  avg_value: number | null;
  data_quality_score: number;
  api_fixture_id: number;
  match_name: string;
  league_name: string | null;
  kickoff_at: string | null;
}

interface UpcomingMultiResult {
  legs: UpcomingLeg[];
  combined_probability: number;
  reason: string;
}

interface UpcomingSummary {
  best_solo: { fixture: UpcomingLeg; reason: string } | null;
  safe_multi: UpcomingMultiResult | null;
  value_multi: UpcomingMultiResult | null;
  considered_fixtures: number;
  ignored_games: Array<{
    api_fixture_id: number;
    match_name: string;
    reason: string;
  }>;
}

export function StudioUpcomingMultiButton({ date }: { date: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UpcomingSummary | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/studio/generate-upcoming-multi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, fromTime: "now", mode: "all" }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.error ?? `Erro ${res.status}`);
        return;
      }
      setResult(json.data as UpcomingSummary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro de rede");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <SparklesIcon className="h-4 w-4 text-primary" />
            Melhor entrada agora
          </CardTitle>
          <CardDescription>
            Gera melhor solo + múltipla segura + múltipla valor combinando
            jogos ainda não iniciados do dia.
          </CardDescription>
        </div>
        <Button onClick={generate} disabled={loading}>
          {loading ? (
            <>
              <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
              gerando…
            </>
          ) : (
            "Gerar melhor múltipla dos próximos jogos"
          )}
        </Button>
      </CardHeader>
      {(error || result) && (
        <CardContent className="space-y-4 text-sm">
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">
              {error}
            </div>
          )}
          {result && (
            <>
              <div className="text-xs text-muted-foreground">
                Jogos considerados: {result.considered_fixtures} · ignorados:{" "}
                {result.ignored_games.length}
              </div>

              {result.best_solo && (
                <ResultBlock
                  title="Melhor solo"
                  legs={[result.best_solo.fixture]}
                  combinedProbability={result.best_solo.fixture.probability}
                  reason={result.best_solo.reason}
                />
              )}
              {result.safe_multi && (
                <ResultBlock
                  title="Melhor múltipla segura"
                  legs={result.safe_multi.legs}
                  combinedProbability={result.safe_multi.combined_probability}
                  reason={result.safe_multi.reason}
                />
              )}
              {result.value_multi && (
                <ResultBlock
                  title="Melhor múltipla valor"
                  legs={result.value_multi.legs}
                  combinedProbability={result.value_multi.combined_probability}
                  reason={result.value_multi.reason}
                />
              )}
              {!result.best_solo &&
                !result.safe_multi &&
                !result.value_multi && (
                  <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-yellow-300">
                    Nenhuma entrada elegível agora. Rode o pipeline ou
                    aguarde mais jogos ficarem READY.
                  </div>
                )}
              {result.ignored_games.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    Jogos ignorados ({result.ignored_games.length})
                  </summary>
                  <ul className="mt-2 space-y-0.5">
                    {result.ignored_games.slice(0, 20).map((g) => (
                      <li
                        key={g.api_fixture_id}
                        className="text-muted-foreground"
                      >
                        <code className="font-mono text-[10px]">
                          {g.api_fixture_id}
                        </code>{" "}
                        {g.match_name} — {g.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function ResultBlock({
  title,
  legs,
  combinedProbability,
  reason,
}: {
  title: string;
  legs: UpcomingLeg[];
  combinedProbability: number;
  reason: string;
}) {
  return (
    <div className="rounded-md border border-border/40 bg-background/40 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <div className="font-semibold">{title}</div>
        <div className="text-xs text-primary">
          combinada: {(combinedProbability * 100).toFixed(1)}%
        </div>
      </div>
      <ul className="space-y-1.5">
        {legs.map((l, i) => (
          <li
            key={`${l.api_fixture_id}-${l.player_name}-${i}`}
            className="rounded-sm border border-border/30 bg-muted/30 px-2 py-1.5 text-xs"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="font-medium">
                {l.player_name} — {l.market}
              </div>
              <div className="text-primary">
                {(l.probability * 100).toFixed(0)}%
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground">
              {l.match_name}
              {l.kickoff_at && (
                <span> · {l.kickoff_at.slice(11, 16)}</span>
              )}
              {" · sample "}
              {l.sample_size}
              {" · dq "}
              {l.data_quality_score.toFixed(2)}
              {l.hit_rate != null && ` · hit ${(l.hit_rate * 100).toFixed(0)}%`}
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-2 text-[10px] text-muted-foreground">{reason}</div>
    </div>
  );
}
