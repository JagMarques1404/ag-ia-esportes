import Link from "next/link";
import {
  AlertTriangleIcon,
  ClockIcon,
  LockIcon,
  ShieldAlertIcon,
  SparklesIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PublicHeader } from "@/components/public-header";
import { PickMarketsList } from "@/components/pick-markets-list";
import { getPicksByDate } from "@/lib/ai/analyst-tools";
import type { DailyPick } from "@/lib/ai/analyst-tools";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayString(): string {
  return new Date().toISOString().split("T")[0];
}
function shiftDate(iso: string, deltaDays: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().split("T")[0];
}

const RISK_STYLES: Record<
  DailyPick["risk"],
  { card: string; badge: string; bar: string }
> = {
  Segura: {
    card: "border-green-500/30 bg-green-500/5",
    badge: "bg-green-500/20 text-green-400 border-green-500/40",
    bar: "bg-green-500",
  },
  Valor: {
    card: "border-yellow-500/30 bg-yellow-500/5",
    badge: "bg-yellow-500/20 text-yellow-400 border-yellow-500/40",
    bar: "bg-yellow-500",
  },
  Mega: {
    card: "border-purple-500/30 bg-purple-500/5",
    badge: "bg-purple-500/20 text-purple-400 border-purple-500/40",
    bar: "bg-purple-500",
  },
};

const STATUS_TO_BADGE: Record<DailyPick["status"], string> = {
  Pendente: "text-muted-foreground",
  "Em análise": "text-yellow-400/80",
  Green: "text-green-400",
  Red: "text-destructive",
  Void: "text-muted-foreground",
};

function defaultConfidenceFor(risk: DailyPick["risk"]): number {
  if (risk === "Segura") return 0.7;
  if (risk === "Valor") return 0.5;
  return 0.2;
}

export default async function PicksPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const sp = await searchParams;
  const requestedDate = sp.date && DATE_RE.test(sp.date) ? sp.date : todayString();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isLoggedIn = !!user;

  const realPicks = await getPicksByDate(requestedDate);
  const isExample = realPicks.length === 0;
  const picks: DailyPick[] = isExample
    ? // Quando não há picks reais, mostramos os exemplos com ressalva.
      // Importante: não usamos getTodayPicks() porque ele faria fallback
      // só para a data de hoje; aqui queremos respeitar a data pedida.
      [
        {
          id: "example-segura",
          match: "Exemplo · selecione uma data com publicação",
          league: "—",
          risk: "Segura",
          odd_target: 1.9,
          status: "Em análise",
          markets: [
            { player: "(jogador 1)", market: "(mercado a publicar)" },
            { player: "(jogador 2)", market: "(mercado a publicar)" },
            { player: "(jogador 3)", market: "(mercado a publicar)" },
          ],
          rationale:
            "Sem pick real publicada para esta data. Use o seletor para escolher outra data ou aguarde a publicação do dia.",
          is_example: true,
        },
      ]
    : realPicks;

  const dateLabel = new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${requestedDate}T12:00:00`));

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicHeader isLoggedIn={isLoggedIn} />

      <section className="container py-10 sm:py-14">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <SparklesIcon className="h-3 w-3" />
            Picks · {dateLabel}
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Picks do Dia
          </h1>

          {/* Date selector */}
          <form
            method="get"
            action="/picks"
            className="mx-auto mt-6 flex flex-wrap items-center justify-center gap-2"
          >
            <Link
              href={`/picks?date=${shiftDate(requestedDate, -1)}`}
              className="rounded-md border border-border/50 bg-background px-3 py-1.5 text-xs hover:bg-accent"
            >
              ← Anterior
            </Link>
            <input
              type="date"
              name="date"
              defaultValue={requestedDate}
              className="rounded-md border border-border/50 bg-background px-2 py-1.5 text-xs"
            />
            <button
              type="submit"
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              Ver
            </button>
            <Link
              href={`/picks?date=${todayString()}`}
              className="rounded-md border border-border/50 bg-background px-3 py-1.5 text-xs hover:bg-accent"
            >
              Hoje
            </Link>
            <Link
              href={`/picks?date=${shiftDate(requestedDate, 1)}`}
              className="rounded-md border border-border/50 bg-background px-3 py-1.5 text-xs hover:bg-accent"
            >
              Seguinte →
            </Link>
            <Link
              href="/picks/history"
              className="rounded-md border border-border/50 bg-background px-3 py-1.5 text-xs hover:bg-accent"
            >
              Histórico
            </Link>
          </form>

          {isExample && (
            <div className="mx-auto mt-5 inline-block rounded-md border border-yellow-500/40 bg-yellow-500/5 px-3 py-1.5 text-xs text-yellow-300">
              <strong>Sem picks publicadas para {requestedDate}.</strong> O card
              abaixo é um placeholder. Quando uma pick real for publicada,
              aparece aqui.
            </div>
          )}
        </div>
      </section>

      <section className="container pb-16 sm:pb-24">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {picks.map((p) => {
            const styles = RISK_STYLES[p.risk];
            const confidence = defaultConfidenceFor(p.risk);
            return (
              <Card
                key={p.id}
                className={`flex flex-col ${styles.card} ${p.is_example ? "opacity-90" : ""}`}
              >
                <CardHeader className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${styles.badge}`}
                    >
                      {p.risk}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 text-xs ${STATUS_TO_BADGE[p.status]}`}
                    >
                      <ClockIcon className="h-3 w-3" />
                      {p.status}
                    </span>
                  </div>
                  <div>
                    <CardTitle className="text-lg">{p.match}</CardTitle>
                    <CardDescription className="mt-1 text-xs">
                      {p.league}
                    </CardDescription>
                  </div>
                  <div className="flex items-end justify-between">
                    <div>
                      <div className="text-xs uppercase text-muted-foreground">
                        Odd alvo
                      </div>
                      <div className="text-2xl font-bold text-primary">
                        {p.odd_target ? p.odd_target.toFixed(2) : "—"}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs uppercase text-muted-foreground">
                        Confiança
                      </div>
                      <div className="mt-1 flex items-center gap-1.5">
                        <div className="h-2 w-20 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full ${styles.bar}`}
                            style={{
                              width: `${Math.round(confidence * 100)}%`,
                            }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {Math.round(confidence * 100)}%
                        </span>
                      </div>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="flex flex-1 flex-col gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
                      <span>Mercados</span>
                      {p.legs_summary && p.legs_summary.total > 0 && (
                        <span>
                          <span className="text-green-400">{p.legs_summary.green}</span>
                          {" / "}
                          <span className="text-destructive">{p.legs_summary.red}</span>
                          {" / "}
                          <span className="text-muted-foreground">{p.legs_summary.void}</span>
                          {p.legs_summary.pending > 0 && (
                            <>
                              {" · "}
                              <span>{p.legs_summary.pending} pend.</span>
                            </>
                          )}
                        </span>
                      )}
                    </div>
                    <PickMarketsList pick={p} />
                  </div>
                  {p.result_notes && (
                    <div className="rounded-md border border-border/40 bg-muted/40 p-3 text-xs text-muted-foreground">
                      <strong className="text-foreground">Resultado:</strong> {p.result_notes}
                    </div>
                  )}
                  {isLoggedIn && !p.is_example && (
                    <Link
                      href={`/admin/picks/${p.id}/settle`}
                      className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      Marcar resultado
                    </Link>
                  )}

                  <div className="rounded-md border border-border/40 bg-muted/40 p-3 text-xs text-muted-foreground">
                    <strong className="text-foreground">Racional:</strong>{" "}
                    {p.rationale}
                  </div>

                  {p.warning && (
                    <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                      <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{p.warning}</span>
                    </div>
                  )}

                  {p.is_example && (
                    <span className="inline-flex w-fit items-center rounded-md border border-yellow-500/40 bg-yellow-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-yellow-400">
                      Exemplo · sem pick real
                    </span>
                  )}

                  <div className="mt-auto pt-2">
                    <Button
                      asChild
                      className="w-full"
                      variant="outline"
                      disabled={p.is_example}
                    >
                      <Link href={isLoggedIn ? "/dashboard" : "/auth/login"}>
                        <LockIcon className="mr-2 h-3.5 w-3.5" />
                        Entrar para ver análise completa
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="mx-auto mt-12 max-w-3xl">
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="flex items-start gap-4 py-6">
              <ShieldAlertIcon className="mt-1 h-6 w-6 shrink-0 text-destructive" />
              <div className="text-sm text-foreground/80">
                <p className="font-medium text-foreground">
                  Aposte com responsabilidade.
                </p>
                <p className="mt-2">
                  Picks são apoio estatístico — não recomendação financeira nem
                  garantia de lucro. Defina banca, stake e limite antes de
                  operar. Maiores de 18 anos.
                </p>
                <p className="mt-2">
                  Se sentir que perdeu o controle:{" "}
                  <span className="font-medium">CVV 188</span> ou{" "}
                  <span className="font-medium">Jogadores Anônimos</span>.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <footer className="border-t border-border/40 bg-card/30">
        <div className="container flex flex-col items-center justify-between gap-4 py-8 text-xs text-muted-foreground sm:flex-row">
          <div>
            © AG IA Esportes — análise estatística, não recomendação financeira.
          </div>
          <div className="flex items-center gap-4">
            <Link href="/" className="hover:text-foreground">
              Home
            </Link>
            <Link href="/picks/history" className="hover:text-foreground">
              Histórico
            </Link>
            <Link href="/auth/login" className="hover:text-foreground">
              Entrar
            </Link>
            <span>18+</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
