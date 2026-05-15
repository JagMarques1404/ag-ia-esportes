import Link from "next/link";
import { ShieldAlertIcon, SparklesIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PublicHeader } from "@/components/public-header";
import { getPickHistory } from "@/lib/ai/analyst-tools";
import type { PickHistoryFilters } from "@/lib/ai/analyst-tools";

export const dynamic = "force-dynamic";

const RISK_BADGE: Record<"Segura" | "Valor" | "Mega", string> = {
  Segura: "bg-green-500/20 text-green-400 border-green-500/40",
  Valor: "bg-yellow-500/20 text-yellow-400 border-yellow-500/40",
  Mega: "bg-purple-500/20 text-purple-400 border-purple-500/40",
};

const STATUS_BADGE: Record<"Green" | "Red" | "Void", string> = {
  Green: "bg-green-500/20 text-green-400 border-green-500/40",
  Red: "bg-destructive/20 text-destructive border-destructive/40",
  Void: "bg-muted text-muted-foreground border-border/40",
};

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${iso}T12:00:00`));
}

export default async function PicksHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; risk?: string }>;
}) {
  const sp = await searchParams;

  const filters: PickHistoryFilters = { limit: 100 };
  if (sp.status === "green") filters.status = ["green"];
  else if (sp.status === "red") filters.status = ["red"];
  else if (sp.status === "void") filters.status = ["void"];

  if (sp.risk === "safe") filters.riskLevel = ["safe"];
  else if (sp.risk === "value") filters.riskLevel = ["value"];
  else if (sp.risk === "mega") filters.riskLevel = ["mega"];

  const items = await getPickHistory(filters);

  // Stats agregadas (sem filtro — sempre)
  const all = await getPickHistory({ limit: 1000 });
  const greens = all.filter((p) => p.status === "Green").length;
  const reds = all.filter((p) => p.status === "Red").length;
  const voids = all.filter((p) => p.status === "Void").length;
  const total = greens + reds + voids;
  const hitRate =
    greens + reds > 0
      ? Math.round((greens / (greens + reds)) * 1000) / 10
      : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isLoggedIn = !!user;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicHeader isLoggedIn={isLoggedIn} />

      <section className="container py-10">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <SparklesIcon className="h-3 w-3" />
            Histórico
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Histórico de Picks
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Cada pick publicada é registrada com resultado. Sem maquiagem.
          </p>
        </div>

        {/* Stats */}
        <div className="mx-auto mt-8 grid max-w-3xl gap-3 grid-cols-2 sm:grid-cols-5">
          <Card className="text-center">
            <CardContent className="py-4">
              <div className="text-2xl font-bold">{total}</div>
              <div className="text-[11px] uppercase text-muted-foreground">
                Resolvidas
              </div>
            </CardContent>
          </Card>
          <Card className="text-center border-green-500/30">
            <CardContent className="py-4">
              <div className="text-2xl font-bold text-green-400">{greens}</div>
              <div className="text-[11px] uppercase text-muted-foreground">
                Green
              </div>
            </CardContent>
          </Card>
          <Card className="text-center border-destructive/30">
            <CardContent className="py-4">
              <div className="text-2xl font-bold text-destructive">{reds}</div>
              <div className="text-[11px] uppercase text-muted-foreground">
                Red
              </div>
            </CardContent>
          </Card>
          <Card className="text-center">
            <CardContent className="py-4">
              <div className="text-2xl font-bold text-muted-foreground">
                {voids}
              </div>
              <div className="text-[11px] uppercase text-muted-foreground">
                Void
              </div>
            </CardContent>
          </Card>
          <Card className="text-center border-primary/30">
            <CardContent className="py-4">
              <div className="text-2xl font-bold text-primary">
                {hitRate != null ? `${hitRate}%` : "—"}
              </div>
              <div className="text-[11px] uppercase text-muted-foreground">
                Hit rate
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filtros */}
        <div className="mx-auto mt-8 flex max-w-3xl flex-wrap justify-center gap-2 text-xs">
          {[
            { label: "Tudo", href: "/picks/history" },
            { label: "Green", href: "/picks/history?status=green" },
            { label: "Red", href: "/picks/history?status=red" },
            { label: "Void", href: "/picks/history?status=void" },
            { label: "Segura", href: "/picks/history?risk=safe" },
            { label: "Valor", href: "/picks/history?risk=value" },
            { label: "Mega", href: "/picks/history?risk=mega" },
          ].map((f) => (
            <Link
              key={f.label}
              href={f.href}
              className="rounded-full border border-border/50 bg-background px-3 py-1 hover:bg-accent"
            >
              {f.label}
            </Link>
          ))}
        </div>

        {/* Lista */}
        <div className="mx-auto mt-8 max-w-3xl space-y-3">
          {items.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Nenhuma pick resolvida ainda nesse filtro.
                <div className="mt-2">
                  <Link href="/picks" className="underline hover:text-foreground">
                    voltar para Picks de Hoje
                  </Link>
                </div>
              </CardContent>
            </Card>
          ) : (
            items.map((p) => (
              <Card key={p.id}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${RISK_BADGE[p.risk]}`}
                      >
                        {p.risk}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[p.status as "Green" | "Red" | "Void"]}`}
                      >
                        {p.status}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {p.pick_date ? fmtDate(p.pick_date) : "?"}
                      </span>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] uppercase text-muted-foreground">
                        Odd alvo
                      </div>
                      <div className="font-bold text-primary">
                        {p.odd_target ? p.odd_target.toFixed(2) : "—"}
                      </div>
                    </div>
                  </div>
                  <CardTitle className="mt-2 text-base">
                    {p.match}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">{p.league}</p>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="space-y-1">
                    {p.markets.map((m, i) => (
                      <div key={i} className="text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {m.player}
                        </span>
                        : {m.market}
                      </div>
                    ))}
                  </div>
                  {p.result_notes && (
                    <div className="rounded-md border border-border/40 bg-muted/40 p-3 text-xs">
                      <strong className="text-foreground">Resultado:</strong>{" "}
                      {p.result_notes}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>

        <div className="mx-auto mt-10 max-w-3xl">
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="flex items-start gap-4 py-6">
              <ShieldAlertIcon className="mt-1 h-6 w-6 shrink-0 text-destructive" />
              <div className="text-xs text-foreground/80">
                Histórico é apoio à transparência. Hit rate isolado não
                garante resultado futuro. Aposte com responsabilidade. 18+.
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mt-8 text-center">
          <Button asChild variant="outline">
            <Link href="/picks">← Voltar para Picks de Hoje</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
