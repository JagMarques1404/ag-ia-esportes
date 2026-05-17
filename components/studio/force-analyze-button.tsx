"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2Icon, RefreshCwIcon } from "lucide-react";

interface FixtureSnapshot {
  api_fixture_id: number;
  match_name: string | null;
  readiness: string;
  lineup_count: number;
  players_with_history: number;
  sample3_count: number;
  dq_avg: number;
  strong_count: number;
  picks_drafted: number;
  reqs_used: number;
  blocked_reason: string | null;
  warnings?: string[];
  error?: string;
}

interface ApiResponse {
  ok: boolean;
  data?: { snapshots: FixtureSnapshot[]; processed?: number };
  error?: string;
}

/**
 * Botão geral (no topo do /studio/jogos): força análise de todos os
 * próximos jogos do dia.
 */
export function StudioForceAnalyzeAllButton({
  date,
  fromTime,
}: {
  date: string;
  fromTime?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [snapshots, setSnapshots] = useState<FixtureSnapshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/studio/force-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          futureOnly: true,
          fromTime,
          maxFixtures: 10,
          dryRun: false,
        }),
      });
      const json = (await res.json()) as ApiResponse;
      if (!res.ok || !json.ok || !json.data) {
        setError(json.error ?? `Erro ${res.status}`);
        return;
      }
      setSnapshots(json.data.snapshots);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro de rede");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button onClick={run} disabled={loading} variant="outline">
        {loading ? (
          <>
            <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
            analisando…
          </>
        ) : (
          <>
            <RefreshCwIcon className="mr-2 h-4 w-4" />
            Forçar análise dos próximos jogos
          </>
        )}
      </Button>
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          {error}
        </div>
      )}
      {snapshots && snapshots.length > 0 && (
        <div className="rounded-md border border-border/40 bg-muted/30 p-3 text-xs">
          <div className="mb-2 font-medium">
            Processados: {snapshots.length}
          </div>
          <ul className="space-y-0.5">
            {snapshots.map((s) => (
              <li
                key={s.api_fixture_id}
                className="flex items-baseline justify-between gap-2"
              >
                <span>
                  <code className="font-mono text-[10px]">
                    {s.api_fixture_id}
                  </code>{" "}
                  {s.match_name ?? "?"}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {s.readiness} · lineup {s.lineup_count}p · hist{" "}
                  {s.players_with_history} · dq {s.dq_avg?.toFixed(2)} · picks{" "}
                  {s.picks_drafted} · reqs {s.reqs_used}
                  {s.blocked_reason && ` · ${s.blocked_reason}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Botão por card: força análise de UM fixture.
 */
export function StudioForceAnalyzeOneButton({
  apiFixtureId,
}: {
  apiFixtureId: number;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<FixtureSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/studio/force-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiFixtureId, dryRun: false }),
      });
      const json = (await res.json()) as ApiResponse;
      if (!res.ok || !json.ok || !json.data) {
        setError(json.error ?? `Erro ${res.status}`);
        return;
      }
      setSnapshot(json.data.snapshots[0] ?? null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro de rede");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-1">
      <Button
        size="sm"
        variant="outline"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          run();
        }}
        disabled={loading}
      >
        {loading ? (
          <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCwIcon className="h-3.5 w-3.5" />
        )}
        <span className="ml-1 text-[10px]">forçar</span>
      </Button>
      {error && (
        <div className="text-[10px] text-destructive">{error}</div>
      )}
      {snapshot && (
        <div className="text-[10px] text-muted-foreground">
          {snapshot.readiness} · {snapshot.picks_drafted} pick(s)
        </div>
      )}
    </div>
  );
}
