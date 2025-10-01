# AG IA ESPORTES

Sistema de análise esportiva baseado em inteligência artificial para identificação de oportunidades de valor no mercado de apostas.

## 🚀 Características

- **Modelo Poisson Bivariado**: Cálculo preciso de probabilidades de gols
- **Análise de Edge**: Identificação automática de oportunidades de valor
- **Atualização Diária**: Processamento automático às 03:00 (horário de Brasília)
- **Interface Moderna**: Design responsivo e profissional
- **Transparência Total**: Explicações detalhadas para cada recomendação

## 🛠 Tecnologias

- **Frontend**: React + Vite + Tailwind CSS
- **Backend**: Supabase (PostgreSQL)
- **Deploy**: Vercel
- **APIs**: API-Football + The Odds API
- **UI Components**: shadcn/ui

## 📊 Funcionalidades

### MVP (Versão Atual)
- ✅ Análise de mercado Over/Under Gols (1.5, 2.5, 3.5)
- ✅ Top 10 picks diários com maior edge
- ✅ Modelo Poisson para cálculo de probabilidades
- ✅ Interface responsiva e profissional
- ✅ Sistema de cron jobs para atualização automática

### Roadmap Futuro
- 🔄 Mercados adicionais (Dupla Chance, Escanteios, Cartões)
- 🔄 Dashboard de métricas e performance
- 🔄 Sistema de múltiplas otimizadas
- 🔄 API de clima para ajustes contextuais
- 🔄 Análise de forma e xG dos times

## 🏗 Arquitetura

```
src/
├── components/          # Componentes React
│   ├── ui/             # Componentes base (shadcn/ui)
│   ├── Header.jsx      # Cabeçalho e navegação
│   ├── ValuePick.jsx   # Componentes de picks
│   └── HowItWorks.jsx  # Seção explicativa
├── hooks/              # Custom hooks
│   └── useTopPicks.js  # Hook para buscar picks
├── lib/                # Utilitários e serviços
│   ├── supabase.js     # Cliente Supabase
│   ├── database.js     # Operações de banco
│   ├── poissonModel.js # Modelo estatístico
│   ├── sportsApi.js    # Integração com APIs
│   └── dailyProcessor.js # Processamento diário
└── api/                # Endpoints da API
    └── daily-process.js # Endpoint do cron job
```

## 🗄 Banco de Dados

### Tabelas Principais
- `fixtures`: Jogos e informações básicas
- `odds_snapshots`: Histórico de odds capturadas
- `recommendations`: Recomendações do modelo
- `daily_publications`: Top picks publicados
- `model_runs`: Log de execuções do modelo

## 🔧 Configuração

### Variáveis de Ambiente
```bash
VITE_SUPABASE_URL=sua_url_supabase
VITE_SUPABASE_ANON_KEY=sua_chave_anonima
VITE_APIFOOTBALL_KEY=sua_chave_api_football
VITE_THEODDSAPI_KEY=sua_chave_odds_api
VITE_OPENWEATHER_KEY=sua_chave_clima
VITE_API_INTERNAL_TOKEN=token_interno
```

### Instalação Local
```bash
# Clonar repositório
git clone [URL_DO_REPO]
cd ag-ia-esportes

# Instalar dependências
pnpm install

# Configurar variáveis de ambiente
cp .env.example .env
# Editar .env com suas chaves

# Executar localmente
pnpm run dev
```

## 📈 Deploy

### Vercel
1. Conectar repositório GitHub à Vercel
2. Configurar variáveis de ambiente
3. Deploy automático a cada push

### Cron Jobs
- Execução diária às 03:00 BRT
- Endpoint: `/api/daily-process`
- Autenticação via token interno

## ⚠️ Disclaimer

Este sistema é uma ferramenta de análise estatística que identifica oportunidades de valor baseadas em modelos matemáticos. Não garantimos resultados e todas as apostas envolvem risco. Use apenas o dinheiro que pode perder e jogue com responsabilidade. Destinado apenas a maiores de 18 anos.

## 📄 Licença

Todos os direitos reservados - AG IA ESPORTES © 2024
