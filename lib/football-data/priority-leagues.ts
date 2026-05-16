/**
 * Listas de ligas usadas pelo motor de futebol.
 *
 * Três conjuntos com propósitos distintos:
 *   - PRIORITY_LEAGUE_NAMES   : cobertura comprovada de /fixtures/players
 *                                no plano free. Usado para acumular histórico
 *                                individual (collect:player-last5 / readiness).
 *   - LOW_COVERAGE_LEAGUE_NAMES: blacklist (provider devolve [] ou IDs inválidos).
 *   - AUTO_PICK_LEAGUE_NAMES  : universo das auto-picks diárias. Set maior,
 *                                pode incluir ligas onde só temos jogos +
 *                                lineup (sem stats individuais profundos).
 *
 * Os nomes devem bater EXATAMENTE com `football_fixtures.league_name` no banco
 * (que é o que vem em response[i].league.name do API-Football). Adicione com
 * cuidado — typos viram filtros silenciosamente vazios.
 */

export const PRIORITY_LEAGUE_NAMES = [
  "Major League Soccer",
  "Copa Do Brasil",
  "Primera A",
  "Liga Profesional Argentina",
  "Liga MX",
] as const;

export const LOW_COVERAGE_LEAGUE_NAMES = [
  "USL League One",
  "USL League Two",
  "USL W League",
  "MLS Next Pro",
  "Liga MX U21",
  "Division di Honor",
] as const;

/**
 * Universo das auto-picks diárias (E.0A+).
 *
 * Decisão: começa amplo (14 ligas globais visíveis ao usuário BR).
 * O gerador vai filtrar internamente jogos sem lineup/stats, então
 * incluir uma liga aqui só significa "vamos olhar quando ela tiver jogo
 * na data" — não significa publicação automática.
 *
 * Nomes baseados no naming canônico do API-Football. Variações
 * regionais conhecidas:
 *   - Brasileirão Série A → API entrega como "Serie A" + country "Brazil"
 *     (igual ao naming da Itália). Mantemos os DOIS nomes para o filtro
 *     pegar ambos; a deduplicação fica por (api_fixture_id) no banco.
 */
export const AUTO_PICK_LEAGUE_NAMES = [
  "Premier League",
  "UEFA Champions League",
  "UEFA Europa League",
  "CONMEBOL Libertadores",
  "CONMEBOL Sudamericana",
  "Serie A", // Brasileirão + Itália (filtragem mais fina por country fica para E.0B)
  "Brasileirão Série A",
  "La Liga",
  "Bundesliga",
  "Ligue 1",
  "Copa Do Brasil",
  "Liga Profesional Argentina",
  "Major League Soccer",
  "Liga MX",
] as const;

export type AutoPickLeagueName = (typeof AUTO_PICK_LEAGUE_NAMES)[number];

// ============================================================
// Canônico por (name, country) — E.0A.1
// ============================================================

/**
 * Lista canônica para matching contra o /leagues do API-Football.
 *
 * Cada entrada casa por `name` exato + `country` exato (case-insensitive).
 * `alt_names` aceita variações regionais ("Brasileirão Série A" vira
 * "Serie A" no payload do provider).
 *
 * Quando o catálogo (football_leagues_catalog) está populado, é ele que
 * define is_auto_pick=true. Esta lista existe apenas para o script de
 * sync saber QUAIS marcar.
 */
export interface CanonicalLeague {
  name: string;
  country: string;
  alt_names?: string[];
}

export const AUTO_PICK_LEAGUES_CANONICAL: CanonicalLeague[] = [
  { name: "Premier League", country: "England" },
  { name: "La Liga", country: "Spain" },
  { name: "Serie A", country: "Italy" },
  // Brasileirão: API-Football usa "Serie A" + country "Brazil".
  // Variantes regionais conhecidas ficam em alt_names para tolerância.
  {
    name: "Serie A",
    country: "Brazil",
    alt_names: ["Brasileirão Série A", "Brasileirao Serie A", "Brasileiro Serie A"],
  },
  { name: "Bundesliga", country: "Germany" },
  { name: "Ligue 1", country: "France" },
  { name: "Copa Do Brasil", country: "Brazil" },
  { name: "Liga Profesional Argentina", country: "Argentina" },
  { name: "Major League Soccer", country: "USA" },
  { name: "Liga MX", country: "Mexico" },
  { name: "CONMEBOL Libertadores", country: "World" },
  { name: "CONMEBOL Sudamericana", country: "World" },
  { name: "UEFA Champions League", country: "World" },
  { name: "UEFA Europa League", country: "World" },
];

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

// ============================================================
// Seed estático (E.0A.2) — IDs canônicos do API-Football
//
// Usado por scripts/seed-football-catalog.ts quando o plano free
// bloqueia /leagues. IDs verificados em produção do provider.
// Atualizar se o provider reatribuir IDs (raro).
// ============================================================

export interface SeededLeague {
  api_league_id: number;
  name: string;
  type: "League" | "Cup";
  country: string;
  country_code: string | null;
}

export const SEEDED_AUTO_PICK_LEAGUES: SeededLeague[] = [
  // Europa — top 5
  { api_league_id: 39,  name: "Premier League",            type: "League", country: "England",   country_code: "GB" },
  { api_league_id: 140, name: "La Liga",                   type: "League", country: "Spain",     country_code: "ES" },
  { api_league_id: 135, name: "Serie A",                   type: "League", country: "Italy",     country_code: "IT" },
  { api_league_id: 78,  name: "Bundesliga",                type: "League", country: "Germany",   country_code: "DE" },
  { api_league_id: 61,  name: "Ligue 1",                   type: "League", country: "France",    country_code: "FR" },

  // Brasil
  { api_league_id: 71,  name: "Serie A",                   type: "League", country: "Brazil",    country_code: "BR" },
  { api_league_id: 73,  name: "Copa Do Brasil",            type: "Cup",    country: "Brazil",    country_code: "BR" },

  // Hispano-Americano
  { api_league_id: 128, name: "Liga Profesional Argentina", type: "League", country: "Argentina", country_code: "AR" },
  { api_league_id: 253, name: "Major League Soccer",        type: "League", country: "USA",       country_code: "US" },
  { api_league_id: 262, name: "Liga MX",                    type: "League", country: "Mexico",    country_code: "MX" },

  // Continentais (country="World" no provider)
  { api_league_id: 2,   name: "UEFA Champions League",     type: "Cup",    country: "World",     country_code: null },
  { api_league_id: 3,   name: "UEFA Europa League",        type: "Cup",    country: "World",     country_code: null },
  { api_league_id: 13,  name: "CONMEBOL Libertadores",     type: "Cup",    country: "World",     country_code: null },
  { api_league_id: 11,  name: "CONMEBOL Sudamericana",     type: "Cup",    country: "World",     country_code: null },
];

/**
 * Decide se uma liga (vinda do /leagues) é auto-pick canônica.
 * Compara `name` exato (+ alt_names) E `country` exato, ambos lowercased.
 */
export function isCanonicalAutoPickLeague(
  leagueName: string | null | undefined,
  countryName: string | null | undefined
): boolean {
  const n = norm(leagueName);
  const c = norm(countryName);
  if (!n || !c) return false;
  for (const entry of AUTO_PICK_LEAGUES_CANONICAL) {
    if (norm(entry.country) !== c) continue;
    if (norm(entry.name) === n) return true;
    if (entry.alt_names?.some((alt) => norm(alt) === n)) return true;
  }
  return false;
}
