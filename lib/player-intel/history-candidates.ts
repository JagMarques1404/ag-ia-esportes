import "@/lib/server-only-guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Tamanho máximo de página do PostgREST do Supabase.
 * Sem paginar, qualquer SELECT acima disso é silenciosamente truncado
 * — o cliente JS não avisa. Usar fetchAllPaginated para varreduras
 * que precisam ler tabelas inteiras.
 */
const PG_DEFAULT_PAGE_SIZE = 1000;

/**
 * Itera .range(start, end) até a página vir vazia ou menor que o
 * pageSize. Retorna a união de todas as páginas.
 */
async function fetchAllPaginated<T>(
  build: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>,
  pageSize: number = PG_DEFAULT_PAGE_SIZE
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  // Hard cap defensivo (50k = 50 páginas) para evitar loop infinito
  // se algum filtro retornar dataset gigante por engano.
  for (let page = 0; page < 50; page++) {
    const to = from + pageSize - 1;
    const { data, error } = await build(from, to);
    if (error) throw new Error(`fetchAllPaginated: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

// Listas canônicas vivem em lib/football-data/priority-leagues.ts.
// Re-exportadas aqui para preservar compatibilidade de imports antigos.
import {
  PRIORITY_LEAGUE_NAMES,
  LOW_COVERAGE_LEAGUE_NAMES,
} from "@/lib/football-data/priority-leagues";
export { PRIORITY_LEAGUE_NAMES, LOW_COVERAGE_LEAGUE_NAMES };

export interface CandidateOptions {
  /** Filtra fixtures de uma data específica (YYYY-MM-DD). */
  date?: string;
  /** Janela retroativa em dias a partir de agora (default 2). */
  daysBack?: number;
  /**
   * Override total de ligas. Se passado, ignora PRIORITY/LOW_COVERAGE.
   * Útil para testes pontuais.
   */
  leagueNames?: readonly string[];
  /** Máximo de candidatos a retornar (default 5). */
  limit?: number;
  /**
   * Se true, aceita ligas fora de PRIORITY_LEAGUE_NAMES. Default false
   * (modo conservador — só ligas comprovadas).
   */
  allowUnknownLeagues?: boolean;
  /**
   * Se true (default), aplica blacklist LOW_COVERAGE_LEAGUE_NAMES mesmo
   * quando allowUnknownLeagues=true. Sem efeito quando o filtro positivo
   * de PRIORITY já está ativo.
   */
  excludeLowCoverage?: boolean;
}

export interface CandidateFixture {
  fixture_id: string;
  api_fixture_id: number;
  league_name: string | null;
  home_team_name: string | null;
  away_team_name: string | null;
  status: string | null;
  kickoff_at: string | null;
  date: string | null;
}

const FT_STATUSES = ["FT", "AET", "PEN"];

function shiftDate(iso: string, deltaDays: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().split("T")[0];
}

function todayString(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Lista fixtures finalizados (FT/AET/PEN), passados, sem registros
 * em football_player_match_stats, ordenados por prioridade de liga
 * e kickoff_at decrescente.
 */
export async function getFinishedFixturesMissingPlayerStats(
  options: CandidateOptions = {}
): Promise<CandidateFixture[]> {
  const supabase = getSupabaseAdmin();
  const limit = options.limit ?? 5;
  const daysBack = options.daysBack ?? 2;
  const allowUnknownLeagues = options.allowUnknownLeagues ?? false;
  const excludeLowCoverage = options.excludeLowCoverage ?? true;
  const priorityLeagues = options.leagueNames ?? PRIORITY_LEAGUE_NAMES;

  // Janela de busca: por data específica OU últimos N dias.
  const now = new Date();
  const today = todayString();
  const lowerDate = options.date ?? shiftDate(today, -Math.max(0, daysBack));
  const upperDate = options.date ?? today;

  // 1. Conjunto de fixture_ids que já têm stats individuais.
  // Paginar — sem isso o PostgREST devolve só 1000 linhas e fixtures
  // já cobertos passariam a ser propostos de novo.
  const covered = await fetchAllPaginated<{ fixture_id: string }>(
    async (from, to) =>
      await supabase
        .from("football_player_match_stats")
        .select("fixture_id")
        .range(from, to)
  );
  const coveredSet = new Set(covered.map((r) => r.fixture_id));

  // 2. Fixtures FT na janela.
  let query = supabase
    .from("football_fixtures")
    .select(
      "id, api_fixture_id, league_name, home_team_name, away_team_name, status, kickoff_at, date"
    )
    .in("status", FT_STATUSES)
    .gte("date", lowerDate)
    .lte("date", upperDate)
    .lt("kickoff_at", now.toISOString())
    .order("kickoff_at", { ascending: false });

  if (options.leagueNames && options.leagueNames.length > 0) {
    // Override total — usa exatamente as ligas passadas, sem aplicar
    // PRIORITY nem blacklist.
    query = query.in("league_name", options.leagueNames as string[]);
  } else if (!allowUnknownLeagues) {
    // Modo conservador (default): só ligas em PRIORITY_LEAGUE_NAMES.
    query = query.in("league_name", PRIORITY_LEAGUE_NAMES as readonly string[] as string[]);
  } else if (excludeLowCoverage) {
    // allowUnknownLeagues=true + excludeLowCoverage=true: aceita
    // qualquer liga MENOS as conhecidas como low-coverage.
    const blacklisted = `(${LOW_COVERAGE_LEAGUE_NAMES.map((n) => `"${n}"`).join(",")})`;
    query = query.not("league_name", "in", blacklisted);
  }

  // Pega um lote bem maior que o limit final, para conseguir
  // priorizar por liga depois.
  query = query.limit(Math.max(limit * 10, 50));

  const { data: rows, error } = await query;
  if (error) {
    throw new Error(`getFinishedFixturesMissingPlayerStats: ${error.message}`);
  }

  const candidates: CandidateFixture[] = (rows ?? []).map((r) => ({
    fixture_id: r.id as string,
    api_fixture_id: r.api_fixture_id as number,
    league_name: (r.league_name as string | null) ?? null,
    home_team_name: (r.home_team_name as string | null) ?? null,
    away_team_name: (r.away_team_name as string | null) ?? null,
    status: (r.status as string | null) ?? null,
    kickoff_at: (r.kickoff_at as string | null) ?? null,
    date: (r.date as string | null) ?? null,
  }));

  // 3. Filtrar os já cobertos.
  const missing = candidates.filter((f) => !coveredSet.has(f.fixture_id));

  // 4. Ordenar por prioridade de liga (PRIORITY_LEAGUE_NAMES vem
  //    primeiro), depois por kickoff_at desc (já vem da query).
  const priorityIndex = new Map<string, number>();
  priorityLeagues.forEach((name, i) => priorityIndex.set(name, i));

  missing.sort((a, b) => {
    const ai = priorityIndex.get(a.league_name ?? "") ?? Number.MAX_SAFE_INTEGER;
    const bi = priorityIndex.get(b.league_name ?? "") ?? Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    const aT = a.kickoff_at ?? "";
    const bT = b.kickoff_at ?? "";
    return bT.localeCompare(aT);
  });

  return missing.slice(0, limit);
}

// ============================================================
// Cobertura agregada (relatório)
// ============================================================

export interface PlayerHistoryCoverage {
  total_players: number;
  total_player_stats: number;
  /** Linhas em football_players com api_player_id null ou <= 0. */
  invalid_players_count: number;
  /** Linhas em football_player_match_stats com api_player_id null ou <= 0. */
  invalid_player_stats_count: number;
  with_one_match: number;
  with_two_matches: number;
  with_three_or_more: number;
  top_by_sample: Array<{
    api_player_id: number;
    player_name: string | null;
    sample_size: number;
  }>;
  top_leagues: Array<{ league_name: string; player_stats_count: number }>;
}

export async function getPlayerHistoryCoverage(): Promise<PlayerHistoryCoverage> {
  const supabase = getSupabaseAdmin();

  const [
    { count: totalPlayers },
    { count: totalStats },
    { count: invalidPlayers },
    { count: invalidPlayerStats },
  ] = await Promise.all([
    supabase.from("football_players").select("*", { count: "exact", head: true }),
    supabase
      .from("football_player_match_stats")
      .select("*", { count: "exact", head: true }),
    supabase
      .from("football_players")
      .select("*", { count: "exact", head: true })
      .or("api_player_id.is.null,api_player_id.lte.0"),
    supabase
      .from("football_player_match_stats")
      .select("*", { count: "exact", head: true })
      .or("api_player_id.is.null,api_player_id.lte.0"),
  ]);

  // Sample por jogador. Paginação obrigatória — o PostgREST do Supabase
  // limita SELECTs a 1000 linhas por padrão. Sem paginar, o bucket
  // sample_size>=2 nunca aparece quando passamos de 1000 stats.
  type StatRow = {
    api_player_id: number | null;
    player_name: string | null;
    football_fixtures: { league_name?: string | null } | { league_name?: string | null }[] | null;
  };
  const stats = await fetchAllPaginated<StatRow>(
    async (from, to) =>
      await supabase
        .from("football_player_match_stats")
        .select(
          "api_player_id, player_name, football_fixtures!inner(league_name)"
        )
        .gt("api_player_id", 0)
        .range(from, to)
  );

  const samplesByPlayer = new Map<
    number,
    { name: string | null; count: number }
  >();
  const matchesByLeague = new Map<string, number>();

  for (const row of stats) {
    const apiId = row.api_player_id;
    if (apiId != null && apiId > 0) {
      const cur = samplesByPlayer.get(apiId) ?? {
        name: row.player_name ?? null,
        count: 0,
      };
      cur.count++;
      if (!cur.name) cur.name = row.player_name ?? null;
      samplesByPlayer.set(apiId, cur);
    }
    // football_fixtures vem como objeto único (innerJoin) ou array,
    // dependendo do tipo do client. Tratar ambos.
    const fxRel = row.football_fixtures;
    let leagueName: string | null = null;
    if (Array.isArray(fxRel)) {
      leagueName = fxRel[0]?.league_name ?? null;
    } else if (fxRel && typeof fxRel === "object") {
      leagueName = fxRel.league_name ?? null;
    }
    if (leagueName) {
      matchesByLeague.set(leagueName, (matchesByLeague.get(leagueName) ?? 0) + 1);
    }
  }

  const buckets = { one: 0, two: 0, threePlus: 0 };
  for (const { count } of samplesByPlayer.values()) {
    if (count === 1) buckets.one++;
    else if (count === 2) buckets.two++;
    else if (count >= 3) buckets.threePlus++;
  }

  const top_by_sample = Array.from(samplesByPlayer.entries())
    .map(([api_player_id, v]) => ({
      api_player_id,
      player_name: v.name,
      sample_size: v.count,
    }))
    .sort((a, b) => b.sample_size - a.sample_size)
    .slice(0, 20);

  const top_leagues = Array.from(matchesByLeague.entries())
    .map(([league_name, player_stats_count]) => ({
      league_name,
      player_stats_count,
    }))
    .sort((a, b) => b.player_stats_count - a.player_stats_count)
    .slice(0, 20);

  return {
    total_players: totalPlayers ?? 0,
    total_player_stats: totalStats ?? 0,
    invalid_players_count: invalidPlayers ?? 0,
    invalid_player_stats_count: invalidPlayerStats ?? 0,
    with_one_match: buckets.one,
    with_two_matches: buckets.two,
    with_three_or_more: buckets.threePlus,
    top_by_sample,
    top_leagues,
  };
}
