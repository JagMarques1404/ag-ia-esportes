# Player History Pipeline — guia operacional

## Por que isso existe

O motor v0.1 do Player Intel calcula probabilidades a partir das médias por
jogo do jogador (`football_player_match_stats`). Sem histórico individual,
todas as probabilidades caem em `prob = 0.01`/`confidence = 0.20` e o output
é marcado como **"não considerar como sinal apostável"**. Para chegar em
`safe`/`intermediate`/`advanced`, precisamos cumprir o ciclo:

> jogo finalizado → `/fixtures/players` → `football_player_match_stats` →
> `recent_form` → `archetype` → matchup → probability

Este pipeline é a etapa **"jogo finalizado → tabela"**.

## Como ler o sample_size

| `sample_size` | Significado | Uso pelo motor |
|---|---|---|
| **0** | nenhum jogo do jogador no banco | `data_quality = 0.20`, hard-cap `prob ≤ 0.10`. Saída sempre marcada como _watchlist/sem sinal_. **Não apostar.** |
| **1** | um único jogo de referência | `data_quality = 0.20`, hard-cap `prob ≤ 0.35`. Tendência ainda é ruído. **Não considerar como padrão.** |
| **2** | dois jogos | `data_quality ≈ 0.50` (bucket "médio"). Começa a indicar tendência consistente, mas frágil. **Tratar como pista, não como recomendação.** |
| **3–4** | três ou quatro jogos | `data_quality ≈ 0.50`. Sinal mais estável. Bom para identificar **arquétipo** com confiança aceitável. |
| **5+** | cinco ou mais jogos | `data_quality ≈ 0.80`. Patamar mínimo para o motor v0.1 emitir picks **safe**/**intermediate**. |

**Por que sample = 1 não conta como padrão?** Uma única observação não
diferencia variação aleatória de tendência. Um zagueiro pode tirar 0 cartões em
10 jogos e amarelo no 11º — se esse 11º for o único no banco, `cards_avg = 1.0`
sem nenhum lastro estatístico.

## O que NUNCA fazer

**Nunca usar stats do próprio jogo analisado como histórico.** Se o motor
calcular probabilidades para o fixture X usando `player_match_stats` que vieram
do próprio fixture X, ele "sabe o futuro". É data leakage clássico — observado
e corrigido na Fase 4.1. A função `getPlayerLastMatches` recebe
`excludeFixtureId` + `beforeKickoffAt` e a query SQL exclui o próprio fixture.

Por isso: mesmo que `--sync` em jogo FT seja viável, **não tira do leakage** —
o stat do jogo entra no banco, mas o motor o filtra na hora do cálculo. O
script avisa quando `--sync` é usado em fixture FT.

## Comandos

### Auditoria sem custo (sempre seguro)

```bash
npm run report:player-history
```
Mostra cobertura atual: total de jogadores, quantos com 1/2/3+ jogos, top ligas
e top jogadores por sample_size. Zero requests à API.

### Pipeline diário em modo dryRun (default)

```bash
npm run daily:player-history
# ou explicitamente:
npm run daily:player-history -- --dryRun=true --limit=5 --daysBack=2
```
Lista os candidatos do dia (FT recentes sem stats, priorizando ligas relevantes)
e estima quantas requests gastaria. Zero custo de API.

### Coleta real (com confirmação)

```bash
npm run daily:player-history -- --dryRun=false --limit=3
```
- Quota floor: aborta se `remaining ≤ 30`.
- Stop automático em erro de plano (`free plan does not have access`).
- Stop automático se quota cair abaixo do floor entre fixtures.
- Imprime snapshot **antes/depois** com diff.

### Coleta cirúrgica para 1 fixture específico (alternativa)

```bash
npm run test:player-intel -- --fixture=API_FIXTURE_ID --sync
```
Custo: 2 requests reais (lineups + player stats). Útil para investigar um jogo
específico ou recuperar um fixture que falhou. **Não recomendado em massa.**

## Regra de quota (plano free API-Football)

- **Limite diário:** 100 requests reais.
- **Soft-limit:** 90 (acima disso, só requisições marcadas como `essential`).
- **Floor do daily pipeline:** 30 — para reservar capacidade para jobs
  importantes (`syncTodayFixtures`, etc.).
- **Janela histórica do free:** ~3 dias. Tentar datas mais antigas é
  silenciosamente bloqueado pelo provider e desperdiça quota — o backfill já
  detecta a mensagem e para.

Cada execução de `daily:player-history` com `--limit=5` consome **até 5
requests reais** (1 por fixture). Em colisão de jogador entre times (visto na
Fase 4.2.1), o dedupe interno corrige antes do upsert e não custa requests
extras.

## Cadência sugerida

| Frequência | Comando | Custo (reqs) |
|---|---|---|
| Diariamente, manhã | `npm run daily:player-history -- --dryRun=false --limit=3` | até 3 |
| 2× por semana | `npm run daily:player-history -- --dryRun=false --limit=5` | até 5 |
| Investigação pontual | `npm run test:player-intel -- --fixture=X --sync` | 2 |

A acumulação tende a ser linear: ~22 jogadores titulares × N fixtures por dia.
Em ~2 semanas o sample médio de jogadores das ligas prioritárias deve cruzar 3+,
desbloqueando picks de qualidade média. Sem upgrade do plano API-Football, é o
caminho mais barato.

## Como isso alimenta o Player Intel

```
daily:player-history
        │
        ▼
football_player_match_stats   (acumula por jogador)
        │
        ▼
calculatePlayerRecentForm     (exclui o próprio fixture)
        │
        ▼
classifyPlayerArchetype       (sample ≥ 2 destrava classificação real)
        │
        ▼
mapDirectMatchups + matchupAdjustment
        │
        ▼
calculatePlayerActionProbability
        │
        ▼
football_player_action_probabilities
```

Quanto maior o `sample_size` médio, mais o motor sai da camada
`watchlist/sem sinal` e começa a produzir picks com `confidence` real.
