import Link from "next/link";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
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

export const dynamic = "force-dynamic";

type RiskLevel = "Segura" | "Valor" | "Mega";

interface PickMarket {
  player: string;
  market: string;
}

interface PickCard {
  id: string;
  risk: RiskLevel;
  match: string;
  league: string;
  oddTarget: string;
  status: "Pendente" | "Em análise";
  confidence: number;
  markets: PickMarket[];
  rationale: string;
  warning?: string;
}

const PICKS: PickCard[] = [
  {
    id: "vitoria-flamengo-segura",
    risk: "Segura",
    match: "Vitória × Flamengo",
    league: "Copa do Brasil",
    oddTarget: "1.90",
    status: "Pendente",
    confidence: 0.78,
    markets: [
      { player: "Bruno Henrique", market: "+2.5 finalizações" },
      { player: "Carrascal", market: "+1.5 finalizações" },
      { player: "José Vitor", market: "+1.5 faltas cometidas" },
    ],
    rationale:
      "Roteiro manual baseado em domínio territorial esperado do Flamengo, volume ofensivo e pressão sobre a defesa do Vitória. Esta prévia ainda não usa sample histórico automatizado para os três jogadores.",
  },
  {
    id: "vitoria-flamengo-valor",
    risk: "Valor",
    match: "Vitória × Flamengo",
    league: "Copa do Brasil",
    oddTarget: "3.20",
    status: "Em análise",
    confidence: 0.55,
    markets: [
      { player: "Bruno Henrique", market: "+3.5 finalizações" },
      { player: "Pedro", market: "marca a qualquer momento" },
      { player: "Allan", market: "+1.5 desarmes" },
    ],
    rationale:
      "Variação mais agressiva da entrada Segura. Combina volume ofensivo do Flamengo com Pedro entrando na zona de finalização e Allan controlando o meio-campo.",
    warning: "Modelo de exemplo — não é entrada oficial publicada.",
  },
  {
    id: "vitoria-flamengo-mega",
    risk: "Mega",
    match: "Vitória × Flamengo",
    league: "Copa do Brasil",
    oddTarget: "8.20",
    status: "Em análise",
    confidence: 0.18,
    markets: [
      { player: "Pedro", market: "marca primeiro gol" },
      { player: "Bruno Henrique", market: "marca a qualquer momento" },
      { player: "Léo Pereira", market: "leva cartão amarelo" },
      { player: "Carrascal", market: "+2 finalizações no gol" },
    ],
    rationale:
      "Combinação de alta variância. Cada perna isolada é plausível, mas a multiplicação derruba a probabilidade. Stake reduzida e expectativa de payoff alto se acertar.",
    warning:
      "Modelo de exemplo — não é entrada oficial publicada. Alta variância: não usar como stake principal.",
  },
];

const RISK_STYLES: Record<RiskLevel, { card: string; badge: string; bar: string }> = {
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

export default async function PicksPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const isLoggedIn = !!user;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicHeader isLoggedIn={isLoggedIn} />

      <section className="container py-10 sm:py-14">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <SparklesIcon className="h-3 w-3" />
            Picks de Hoje · prévia
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Picks do Dia
          </h1>
          <p className="mt-4 text-muted-foreground">
            Cards mostrados como prévia da experiência. A análise completa, mercados detalhados
            e o histórico ficam disponíveis no Beta Fundador.
          </p>
          <div className="mx-auto mt-5 inline-block rounded-md border border-yellow-500/40 bg-yellow-500/5 px-3 py-1.5 text-xs text-yellow-300">
            <strong>Preview mock</strong> — picks reais por data entram a partir da Fase 5.4B
            (publicação por banco). Sem sample histórico automatizado ainda.
          </div>
        </div>
      </section>

      <section className="container pb-16 sm:pb-24">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {PICKS.map((p) => {
            const styles = RISK_STYLES[p.risk];
            return (
              <Card key={p.id} className={`flex flex-col ${styles.card}`}>
                <CardHeader className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${styles.badge}`}
                    >
                      {p.risk}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
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
                      <div className="text-xs uppercase text-muted-foreground">Odd alvo</div>
                      <div className="text-2xl font-bold text-primary">{p.oddTarget}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs uppercase text-muted-foreground">Confiança</div>
                      <div className="mt-1 flex items-center gap-1.5">
                        <div className="h-2 w-20 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full ${styles.bar}`}
                            style={{ width: `${Math.round(p.confidence * 100)}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {Math.round(p.confidence * 100)}%
                        </span>
                      </div>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="flex flex-1 flex-col gap-4">
                  <div className="space-y-2">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Mercados
                    </div>
                    <ul className="space-y-2">
                      {p.markets.map((m, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          <span>
                            <span className="font-medium">{m.player}</span>{" "}
                            <span className="text-muted-foreground">{m.market}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-md border border-border/40 bg-muted/40 p-3 text-xs text-muted-foreground">
                    <strong className="text-foreground">Racional:</strong> {p.rationale}
                  </div>

                  {p.warning && (
                    <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                      <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{p.warning}</span>
                    </div>
                  )}

                  <div className="mt-auto pt-2">
                    <Button asChild className="w-full" variant="outline">
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
                  Picks são apoio estatístico — não recomendação financeira nem garantia de lucro.
                  Defina banca, stake e limite antes de operar. Maiores de 18 anos.
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
          <div>© AG IA Esportes — análise estatística, não recomendação financeira.</div>
          <div className="flex items-center gap-4">
            <Link href="/" className="hover:text-foreground">
              Home
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
