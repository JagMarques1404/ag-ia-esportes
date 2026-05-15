import Link from "next/link";
import {
  ActivityIcon,
  BarChart3Icon,
  BrainCircuitIcon,
  CheckCircle2Icon,
  ShieldAlertIcon,
  SparklesIcon,
  TargetIcon,
  ZapIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PublicHeader } from "@/components/public-header";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const isLoggedIn = !!user;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicHeader isLoggedIn={isLoggedIn} />

      {/* ============================================================ */}
      {/* HERO                                                          */}
      {/* ============================================================ */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-20%,hsl(142_71%_45%/0.18),transparent_60%)]" />
        <div className="container relative py-16 sm:py-24 md:py-32">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <SparklesIcon className="h-3 w-3" />
              Beta Fundador aberto
            </div>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
              AG IA Esportes
            </h1>
            <p className="mt-6 text-xl text-foreground sm:text-2xl">
              Análises esportivas com inteligência de dados.
            </p>
            <p className="mt-4 text-base text-muted-foreground sm:text-lg">
              Picks diárias com foco em mercados de jogador: finalizações, faltas, desarmes,
              cartões e participações.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="w-full sm:w-auto">
                <Link href="/picks">Ver Picks de Hoje</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
                <Link href={isLoggedIn ? "/dashboard" : "/auth/signup"}>
                  Entrar no Beta Fundador
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/* COMO FUNCIONA                                                 */}
      {/* ============================================================ */}
      <section className="container py-16 sm:py-24">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Como funciona</h2>
          <p className="mt-4 text-muted-foreground">
            Pipeline server-side que transforma jogos brutos em sinais individuais.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {[
            {
              icon: ActivityIcon,
              title: "Coleta jogos",
              desc: "Fixtures, escalações e estatísticas das ligas suportadas, atualizados diariamente.",
            },
            {
              icon: BrainCircuitIcon,
              title: "Analisa escalações",
              desc: "Lineups confirmados, minutagem provável e arquétipos por jogador.",
            },
            {
              icon: TargetIcon,
              title: "Cruza jogadores e ações",
              desc: "Confronto direto + histórico recente alimentam a probabilidade por mercado.",
            },
            {
              icon: BarChart3Icon,
              title: "Classifica por risco",
              desc: "Cada pick recebe odd justa, nível de confiança e categoria (Segura/Valor/Mega).",
            },
          ].map((item) => (
            <Card key={item.title} className="border-border/50 bg-card/50">
              <CardHeader>
                <item.icon className="h-8 w-8 text-primary" />
                <CardTitle className="mt-3 text-lg">{item.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{item.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* ============================================================ */}
      {/* TIPOS DE ENTRADA                                              */}
      {/* ============================================================ */}
      <section className="container py-16 sm:py-24 border-t border-border/40">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Tipos de entrada</h2>
          <p className="mt-4 text-muted-foreground">
            Três níveis de risco, três objetivos diferentes. Você decide qual fazer parte da sua banca.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {[
            {
              tag: "Segura",
              color: "border-green-500/30 bg-green-500/5",
              badge: "bg-green-500/20 text-green-400",
              title: "Entrada Segura",
              odd: "1.50 – 2.20",
              desc: "Picks com maior probabilidade combinada. Ideal para fluxo constante de banca.",
            },
            {
              tag: "Valor",
              color: "border-yellow-500/30 bg-yellow-500/5",
              badge: "bg-yellow-500/20 text-yellow-400",
              title: "Entrada Valor",
              odd: "2.50 – 4.50",
              desc: "Onde o modelo identifica preço acima do justo. Variância moderada, retorno melhor.",
            },
            {
              tag: "Mega",
              color: "border-purple-500/30 bg-purple-500/5",
              badge: "bg-purple-500/20 text-purple-400",
              title: "Entrada Mega",
              odd: "6.00+",
              desc: "Combinações de alta variância. Stake reduzida, expectativa de hit baixa, payoff alto.",
            },
          ].map((t) => (
            <Card key={t.tag} className={t.color}>
              <CardHeader>
                <span
                  className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-medium ${t.badge}`}
                >
                  {t.tag}
                </span>
                <CardTitle className="mt-3 text-2xl">{t.title}</CardTitle>
                <CardDescription className="text-base font-medium text-foreground/80">
                  Odd alvo: {t.odd}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{t.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* ============================================================ */}
      {/* EXEMPLO DE ANÁLISE                                            */}
      {/* ============================================================ */}
      <section className="container py-16 sm:py-24 border-t border-border/40">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Exemplo de análise</h2>
          <p className="mt-4 text-muted-foreground">
            Como uma pick é apresentada na plataforma.
          </p>
        </div>
        <div className="mx-auto max-w-2xl">
          <Card className="border-primary/30 bg-card/70 shadow-lg shadow-primary/5">
            <CardHeader className="border-b border-border/40">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-xl">Vitória × Flamengo</CardTitle>
                  <CardDescription className="mt-1">Copa do Brasil · Entrada Valor</CardDescription>
                </div>
                <div className="text-right">
                  <div className="text-xs uppercase text-muted-foreground">Odd alvo</div>
                  <div className="text-2xl font-bold text-primary">1.90</div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 pt-6">
              <div className="flex items-start gap-3">
                <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="text-sm">
                  <span className="font-medium">Bruno Henrique</span>{" "}
                  <span className="text-muted-foreground">+2.5 finalizações</span>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="text-sm">
                  <span className="font-medium">Carrascal</span>{" "}
                  <span className="text-muted-foreground">+1.5 finalizações</span>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="text-sm">
                  <span className="font-medium">José Vitor</span>{" "}
                  <span className="text-muted-foreground">+1.5 faltas cometidas</span>
                </div>
              </div>
              <div className="rounded-md border border-border/40 bg-muted/40 p-3 text-sm text-muted-foreground">
                <strong className="text-foreground">Racional:</strong> roteiro baseado em domínio
                territorial do Flamengo, volume ofensivo e pressão sobre a defesa do Vitória.
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ============================================================ */}
      {/* HISTÓRICO TRANSPARENTE                                        */}
      {/* ============================================================ */}
      <section className="container py-16 sm:py-24 border-t border-border/40">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Histórico transparente</h2>
          <p className="mt-4 text-muted-foreground">
            Cada pick publicada é registrada. Sem maquiagem, sem "apaga e refaz".
          </p>
        </div>
        <div className="mx-auto grid max-w-3xl gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {[
            { label: "Green", value: "—", color: "text-green-400" },
            { label: "Red", value: "—", color: "text-destructive" },
            { label: "Void", value: "—", color: "text-muted-foreground" },
            { label: "ROI", value: "—", color: "text-primary" },
            { label: "Odd média", value: "—", color: "text-foreground" },
          ].map((stat) => (
            <Card key={stat.label} className="border-border/50 bg-card/50 text-center">
              <CardContent className="py-6">
                <div className={`text-3xl font-bold ${stat.color}`}>{stat.value}</div>
                <div className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
                  {stat.label}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-muted-foreground">
          O histórico público será exibido aqui assim que tivermos uma amostra estatística válida
          (mínimo 50 picks resolvidas). Antes disso, qualquer número seria propaganda — não dado.
        </p>
      </section>

      {/* ============================================================ */}
      {/* PLANO BETA FUNDADOR                                           */}
      {/* ============================================================ */}
      <section className="container py-16 sm:py-24 border-t border-border/40">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Plano Beta Fundador</h2>
          <p className="mt-4 text-muted-foreground">
            Vagas limitadas. Preço travado enquanto o produto cresce.
          </p>
        </div>
        <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-2">
          <Card className="relative border-border/50 bg-card/50">
            <CardHeader>
              <CardDescription className="uppercase tracking-wide">Mensal</CardDescription>
              <CardTitle className="text-4xl">
                R$ 29,90
                <span className="text-base font-normal text-muted-foreground"> / mês</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <FeatureLine>Acesso completo à página de Picks de Hoje</FeatureLine>
              <FeatureLine>Picks de mercados de jogador detalhados</FeatureLine>
              <FeatureLine>Histórico transparente em tempo real</FeatureLine>
              <FeatureLine>Categoria Segura, Valor e Mega</FeatureLine>
              <Button asChild className="mt-4 w-full">
                <Link href={isLoggedIn ? "/dashboard" : "/auth/signup"}>
                  Entrar no Beta
                </Link>
              </Button>
            </CardContent>
          </Card>
          <Card className="relative border-primary/40 bg-primary/5 shadow-lg shadow-primary/10">
            <div className="absolute -top-3 left-6 inline-flex items-center gap-1 rounded-full border border-primary/50 bg-background px-3 py-1 text-xs font-medium text-primary">
              <ZapIcon className="h-3 w-3" />
              Recomendado
            </div>
            <CardHeader>
              <CardDescription className="uppercase tracking-wide">Plus</CardDescription>
              <CardTitle className="text-4xl">
                R$ 49,90
                <span className="text-base font-normal text-muted-foreground"> / mês</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <FeatureLine>Tudo do plano Mensal</FeatureLine>
              <FeatureLine>Análise tática expandida por jogo</FeatureLine>
              <FeatureLine>Alertas de mudança de lineup (em breve)</FeatureLine>
              <FeatureLine>Prioridade nas próximas features</FeatureLine>
              <Button asChild className="mt-4 w-full">
                <Link href={isLoggedIn ? "/dashboard" : "/auth/signup"}>
                  Entrar no Plus
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ============================================================ */}
      {/* AVISO RESPONSÁVEL                                             */}
      {/* ============================================================ */}
      <section className="container py-16 sm:py-20 border-t border-border/40">
        <div className="mx-auto max-w-3xl">
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="flex items-start gap-4 py-6">
              <ShieldAlertIcon className="mt-1 h-6 w-6 shrink-0 text-destructive" />
              <div className="text-sm text-foreground/80">
                <p className="font-medium text-foreground">Aposte com responsabilidade.</p>
                <p className="mt-2">
                  As análises do AG IA Esportes são apoio estatístico e educacional. Não há garantia
                  de lucro. Apostas envolvem risco financeiro e podem causar prejuízo.
                </p>
                <p className="mt-2">
                  Acesso permitido apenas a maiores de 18 anos. Se sentir que perdeu o controle:{" "}
                  <span className="font-medium">CVV 188</span> ou{" "}
                  <span className="font-medium">Jogadores Anônimos</span>.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ============================================================ */}
      {/* FOOTER                                                         */}
      {/* ============================================================ */}
      <footer className="border-t border-border/40 bg-card/30">
        <div className="container flex flex-col items-center justify-between gap-4 py-8 text-xs text-muted-foreground sm:flex-row">
          <div>© AG IA Esportes — análise estatística, não recomendação financeira.</div>
          <div className="flex items-center gap-4">
            <Link href="/picks" className="hover:text-foreground">
              Picks
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

function FeatureLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <span>{children}</span>
    </div>
  );
}

