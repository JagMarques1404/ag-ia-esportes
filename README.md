# AG IA Esportes — MVP Fase 1

Sistema de tracking de apostas esportivas com gestão de banca rigorosa.

## O que o MVP entrega

✅ Login/cadastro (Supabase Auth)
✅ Configuração de banca inicial + framework de gestão
✅ Dashboard com saldo, lucro diário/semanal/mensal, ROI
✅ Registro manual de apostas (single ou múltipla)
✅ Histórico completo com filtros (período, tier, mercado, liga, resultado)
✅ Alertas automáticos quando estoura o framework
✅ Tracking de ROI por liga, mercado, tier
✅ Sistema de proteção: stop-loss, stop-win, timeout

## Stack

- Next.js 15 (App Router)
- TypeScript
- Tailwind CSS
- shadcn/ui
- Supabase (Postgres + Auth)
- Recharts (gráficos)
- Zod (validação)
- React Hook Form

## Setup — passo a passo

### 1. Pré-requisitos

```bash
node -v   # >= 20
npm -v    # >= 10
git --version
```

### 2. Clone/baixe os arquivos

Coloque todos os arquivos deste pacote em uma pasta `ag-ia-esportes-mvp/`.

### 3. Crie conta no Supabase

1. Vá para [supabase.com](https://supabase.com)
2. Crie conta (free tier serve)
3. Crie um novo projeto
4. Anote: Project URL e anon/public key
5. Vá em SQL Editor e rode o conteúdo de `supabase/migrations/001_init.sql`

### 4. Configure variáveis de ambiente

Crie arquivo `.env.local` na raiz:

```env
NEXT_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua_anon_key_aqui
```

### 5. Instale dependências

```bash
npm install
```

### 6. Rode em desenvolvimento

```bash
npm run dev
```

Acesse http://localhost:3000

### 7. Deploy (opcional, gratuito)

```bash
npm install -g vercel
vercel
```

Adicione as env vars na Vercel.

## Estrutura

```
ag-ia-esportes-mvp/
├── app/                        # Next.js App Router
│   ├── auth/                   # Login + Signup
│   ├── dashboard/              # Dashboard principal
│   ├── bets/                   # Registro e lista de apostas
│   ├── history/                # Histórico completo
│   ├── settings/               # Config de banca e framework
│   ├── api/                    # Backend
│   └── layout.tsx              # Layout raiz
├── components/                 # Componentes React
│   ├── ui/                     # shadcn/ui base
│   ├── dashboard/              # Cards do dashboard
│   └── bets/                   # Formulários de apostas
├── lib/                        # Utilities
│   ├── supabase/               # Cliente Supabase
│   └── utils/                  # EV calc, framework checks
├── types/                      # TypeScript types
├── supabase/migrations/        # SQL initial
└── README.md
```

## Como usar — primeiro fluxo

1. **Cadastre-se** em /auth/signup
2. **Configure banca** em /settings:
   - Saldo inicial: R$X
   - Stake máx por aposta: 5% (default)
   - Limite diário: 12% (default)
   - Stop-loss: -10% (default)
   - Stop-win: +25% (default)
3. **Registre aposta** em /bets/new:
   - Casa de aposta
   - Tipo (single/múltipla)
   - Pernas (jogo, mercado, odd)
   - Stake
   - Sistema valida contra framework
4. **Acompanhe** em /dashboard:
   - Saldo atual
   - Lucro do dia
   - ROI acumulado
   - Status do framework (verde/amarelo/vermelho)
5. **Resolve aposta** em /bets:
   - Marca como ganha/perdida/cashout
   - Atualiza saldo automaticamente
6. **Analise** em /history:
   - ROI por liga, mercado, tier
   - Padrões pessoais
   - Disciplina de framework

## Framework de gestão (default — configurável)

| Regra | Valor |
|---|---|
| Stake máx por aposta | 5% da banca |
| Limite diário | 12% da banca |
| Stop-loss diário | -10% da banca |
| Stop-win diário | +25% da banca |
| Timeout após 3 perdas | 30 min |
| Bloqueio após stop-loss | 24h |

## Próximas fases (não incluídas no MVP)

- **Fase 2:** Integração Claude API pra análise de jogos
- **Fase 3:** API-Football pra dados automáticos
- **Fase 4:** Dobra do Dia + Mega Sena Racional automatizadas
- **Fase 5:** Cashout Inteligente
- **Fase 6:** Multi-usuário + monetização

## Suporte

Apostas envolvem risco financeiro. Aposte com responsabilidade.
Se sentir que perdeu controle: **188 (CVV)** | **Jogadores Anônimos**

---

Desenvolvido pra organização e disciplina, não pra incentivar apostas.
