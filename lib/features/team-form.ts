import "@/lib/server-only-guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { normalizeRate, roundDecimal, safeDivide } from "./math";

export type FormScope = "overall" | "home" | "away";

export interface GetTeamLastFixturesOptions {
  /** Quantos jogos finalizados retornar (default 5). */
  limit?: number;
  /** Filtrar pelo papel do time. */
  scope?: FormScope;
  /** Limita à liga (uuid interno) — se omitido, considera todas. */
  leagueId?: string;
  /** Considera apenas jogos antes desta data ISO (YYYY-MM-DD). */
  beforeDate?: string;
}

export interface FixtureForFormRow {
  id: string;
  api_fixture_id: number;
  date: string;
  status: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  api_home_team_id: number | null;
  api_away_team_id: number | null;
  goals_home: number | null;
  goals_away: number | null;
  league_id: string | null;
  api_league_id: number | null;
  season: number | null;
}

const FT_STATUSES = ["FT", "AET", "PEN"];

export async function getTeamLastFixtures(
  apiTeamId: number,
  options: GetTeamLastFixturesOptions = {}
): Promise<FixtureForFormRow[]> {
  const { limit = 5, scope = "overall", leagueId, beforeDate } = options;
  const supabase = getSupabaseAdmin();

  let query = supabase
    .from("football_fixtures")
    .select(
      "id, api_fixture_id, date, status, home_team_id, away_team_id, api_home_team_id, api_away_team_id, goals_home, goals_away, league_id, api_league_id, season"
    )
    .in("status", FT_STATUSES)
    .not("goals_home", "is", null)
    .not("goals_away", "is", null)
    .order("date", { ascending: false })
    .limit(limit);

  if (scope === "home") {
    query = query.eq("api_home_team_id", apiTeamId);
  } else if (scope === "away") {
    query = query.eq("api_away_team_id", apiTeamId);
  } else {
    query = query.or(
      `api_home_team_id.eq.${apiTeamId},api_away_team_id.eq.${apiTeamId}`
    );
  }

  if (leagueId) query = query.eq("league_id", leagueId);
  if (beforeDate) query = query.lt("date", beforeDate);

  const { data, error } = await query;
  if (error) {
    throw new Error(`getTeamLastFixtures: ${error.message}`);
  }
  return (data ?? []) as FixtureForFormRow[];
}

// ============================================================
// Agregação
// ============================================================

export interface TeamRecentFormResult {
  team_id: string;
  api_team_id: number;
  league_id: string | null;
  api_league_id: number | null;
  season: number | null;
  scope: FormScope;
  sample_size: number;
  matches_played: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  avg_goals_for: number;
  avg_goals_against: number;
  clean_sheets: number;
  failed_to_score: number;
  over_05_goals_rate: number;
  over_15_goals_rate: number;
  over_25_goals_rate: number;
  btts_rate: number;
  scored_rate: number;
  conceded_rate: number;
  /** Sem stats por tempo no banco ainda — placeholder neutro. */
  first_half_goal_rate: number;
  second_half_goal_rate: number;
  avg_corners_for: number | null;
  avg_corners_against: number | null;
  avg_cards_for: number | null;
  avg_cards_against: number | null;
  avg_shots_on_goal_for: number | null;
  avg_shots_on_goal_against: number | null;
}

interface CalculateOptions extends GetTeamLastFixturesOptions {
  /** UUID interno do time. Obrigatório. */
  teamId: string;
  /** ID externo do time (api-football). Obrigatório. */
  apiTeamId: number;
}

/**
 * Calcula form para um único scope. Usa apenas dados já presentes no
 * banco — não chama API externa. Sample baixo é normal e fica
 * sinalizado em `sample_size`.
 */
export async function calculateTeamRecentForm(
  options: CalculateOptions
): Promise<TeamRecentFormResult> {
  const { teamId, apiTeamId, scope = "overall" } = options;
  const fixtures = await getTeamLastFixtures(apiTeamId, options);

  let wins = 0;
  let draws = 0;
  let losses = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  let cleanSheets = 0;
  let failedToScore = 0;
  let over05 = 0;
  let over15 = 0;
  let over25 = 0;
  let btts = 0;
  let scored = 0;
  let conceded = 0;

  let leagueId: string | null = null;
  let apiLeagueId: number | null = null;
  let season: number | null = null;

  for (const f of fixtures) {
    if (f.goals_home == null || f.goals_away == null) continue;
    const isHome = f.api_home_team_id === apiTeamId;
    const for_ = isHome ? f.goals_home : f.goals_away;
    const agst = isHome ? f.goals_away : f.goals_home;
    const total = (f.goals_home ?? 0) + (f.goals_away ?? 0);

    goalsFor += for_;
    goalsAgainst += agst;
    if (for_ > agst) wins++;
    else if (for_ < agst) losses++;
    else draws++;

    if (agst === 0) cleanSheets++;
    if (for_ === 0) failedToScore++;
    if (for_ > 0) scored++;
    if (agst > 0) conceded++;
    if (for_ > 0 && agst > 0) btts++;
    if (total >= 1) over05++;
    if (total >= 2) over15++;
    if (total >= 3) over25++;

    // Captura a liga/temporada do jogo mais recente para a chave
    // de upsert (jogos retornam ordenados por date DESC, primeiro é
    // o mais recente).
    if (leagueId === null) {
      leagueId = f.league_id;
      apiLeagueId = f.api_league_id;
      season = f.season;
    }
  }

  const n = fixtures.length;

  return {
    team_id: teamId,
    api_team_id: apiTeamId,
    league_id: leagueId,
    api_league_id: apiLeagueId,
    season,
    scope,
    sample_size: n,
    matches_played: n,
    wins,
    draws,
    losses,
    goals_for: roundDecimal(goalsFor, 2),
    goals_against: roundDecimal(goalsAgainst, 2),
    avg_goals_for: roundDecimal(safeDivide(goalsFor, n, 0), 3),
    avg_goals_against: roundDecimal(safeDivide(goalsAgainst, n, 0), 3),
    clean_sheets: cleanSheets,
    failed_to_score: failedToScore,
    over_05_goals_rate: roundDecimal(
      normalizeRate(safeDivide(over05, n, 0)),
      4
    ),
    over_15_goals_rate: roundDecimal(
      normalizeRate(safeDivide(over15, n, 0)),
      4
    ),
    over_25_goals_rate: roundDecimal(
      normalizeRate(safeDivide(over25, n, 0)),
      4
    ),
    btts_rate: roundDecimal(normalizeRate(safeDivide(btts, n, 0)), 4),
    scored_rate: roundDecimal(normalizeRate(safeDivide(scored, n, 0)), 4),
    conceded_rate: roundDecimal(normalizeRate(safeDivide(conceded, n, 0)), 4),
    // Sem stats granulares por tempo no banco ainda. Em v0.1 marcamos
    // como 0 (neutro). Será populado quando ingerirmos /fixtures/events.
    first_half_goal_rate: 0,
    second_half_goal_rate: 0,
    avg_corners_for: null,
    avg_corners_against: null,
    avg_cards_for: null,
    avg_cards_against: null,
    avg_shots_on_goal_for: null,
    avg_shots_on_goal_against: null,
  };
}

/**
 * Calcula os 3 splits (overall / home / away) de uma só vez.
 */
export async function calculateHomeAwaySplits(
  options: CalculateOptions
): Promise<TeamRecentFormResult[]> {
  const scopes: FormScope[] = ["overall", "home", "away"];
  const results: TeamRecentFormResult[] = [];
  for (const scope of scopes) {
    results.push(await calculateTeamRecentForm({ ...options, scope }));
  }
  return results;
}

/**
 * Persiste em football_team_recent_form. Faz upsert em
 * (team_id, league_id, season, scope) — usando a UNIQUE INDEX que
 * trata NULLs via COALESCE no schema 006.
 */
export async function upsertTeamRecentForm(
  form: TeamRecentFormResult
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const payload = {
    team_id: form.team_id,
    api_team_id: form.api_team_id,
    league_id: form.league_id,
    api_league_id: form.api_league_id,
    season: form.season,
    scope: form.scope,
    sample_size: form.sample_size,
    matches_played: form.matches_played,
    wins: form.wins,
    draws: form.draws,
    losses: form.losses,
    goals_for: form.goals_for,
    goals_against: form.goals_against,
    avg_goals_for: form.avg_goals_for,
    avg_goals_against: form.avg_goals_against,
    clean_sheets: form.clean_sheets,
    failed_to_score: form.failed_to_score,
    over_05_goals_rate: form.over_05_goals_rate,
    over_15_goals_rate: form.over_15_goals_rate,
    over_25_goals_rate: form.over_25_goals_rate,
    btts_rate: form.btts_rate,
    scored_rate: form.scored_rate,
    conceded_rate: form.conceded_rate,
    first_half_goal_rate: form.first_half_goal_rate,
    second_half_goal_rate: form.second_half_goal_rate,
    avg_corners_for: form.avg_corners_for,
    avg_corners_against: form.avg_corners_against,
    avg_cards_for: form.avg_cards_for,
    avg_cards_against: form.avg_cards_against,
    avg_shots_on_goal_for: form.avg_shots_on_goal_for,
    avg_shots_on_goal_against: form.avg_shots_on_goal_against,
    calculated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Como a UNIQUE é uma INDEX expression (com COALESCE), Supabase JS
  // não aceita onConflict apontando para ela. Faço delete+insert por
  // chave lógica, tratando NULLs com .is(null).
  // Em v0.1, isso é suficiente — volume é baixo.
  let del = supabase
    .from("football_team_recent_form")
    .delete()
    .eq("team_id", form.team_id)
    .eq("scope", form.scope);
  del =
    form.season == null
      ? del.is("season", null)
      : del.eq("season", form.season);
  del =
    form.league_id == null
      ? del.is("league_id", null)
      : del.eq("league_id", form.league_id);
  const { error: delError } = await del;
  if (delError) {
    throw new Error(`upsertTeamRecentForm (delete): ${delError.message}`);
  }

  const { error } = await supabase
    .from("football_team_recent_form")
    .insert(payload);
  if (error) {
    throw new Error(`upsertTeamRecentForm (insert): ${error.message}`);
  }
}
