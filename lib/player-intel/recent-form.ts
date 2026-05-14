import "@/lib/server-only-guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { roundDecimal, safeDivide } from "@/lib/features/math";

export interface PlayerRecentForm {
  player_id: string;
  api_player_id: number;
  team_id: string | null;
  sample_size: number;
  minutes_avg: number;
  shots_avg: number;
  shots_on_avg: number;
  fouls_committed_avg: number;
  fouls_drawn_avg: number;
  tackles_avg: number;
  interceptions_avg: number;
  cards_avg: number;
  key_passes_avg: number;
  /** Não há coluna em football_player_match_stats — placeholder. */
  crosses_avg: number;
  duels_won_avg: number;
  duels_lost_avg: number;
}

export interface GetPlayerLastMatchesOptions {
  /** Máximo de jogos a considerar (default 5). */
  limit?: number;
  /** Considera apenas jogos antes desta data (YYYY-MM-DD). */
  beforeDate?: string;
}

interface PlayerStatRow {
  fixture_id: string;
  minutes: number | null;
  shots_total: number | null;
  shots_on: number | null;
  fouls_committed: number | null;
  fouls_drawn: number | null;
  tackles_total: number | null;
  interceptions: number | null;
  yellow_cards: number | null;
  red_cards: number | null;
  passes_key: number | null;
  duels_total: number | null;
  duels_won: number | null;
}

export async function getPlayerLastMatches(
  apiPlayerId: number,
  options: GetPlayerLastMatchesOptions = {}
): Promise<PlayerStatRow[]> {
  const { limit = 5, beforeDate } = options;
  const supabase = getSupabaseAdmin();

  // Joga LEFT JOIN via select aninhado: filtra por fixture.date < beforeDate.
  let query = supabase
    .from("football_player_match_stats")
    .select(
      "fixture_id, minutes, shots_total, shots_on, fouls_committed, fouls_drawn, tackles_total, interceptions, yellow_cards, red_cards, passes_total, passes_key, duels_total, duels_won, football_fixtures!inner(date, status)"
    )
    .eq("api_player_id", apiPlayerId)
    .in("football_fixtures.status", ["FT", "AET", "PEN"])
    .order("created_at", { ascending: false })
    .limit(limit);

  if (beforeDate) {
    query = query.lt("football_fixtures.date", beforeDate);
  }

  const { data, error } = await query;
  if (error) throw new Error(`getPlayerLastMatches: ${error.message}`);

  return (data ?? []).map((r) => ({
    fixture_id: r.fixture_id as string,
    minutes: (r.minutes as number | null) ?? null,
    shots_total: (r.shots_total as number | null) ?? null,
    shots_on: (r.shots_on as number | null) ?? null,
    fouls_committed: (r.fouls_committed as number | null) ?? null,
    fouls_drawn: (r.fouls_drawn as number | null) ?? null,
    tackles_total: (r.tackles_total as number | null) ?? null,
    interceptions: (r.interceptions as number | null) ?? null,
    yellow_cards: (r.yellow_cards as number | null) ?? null,
    red_cards: (r.red_cards as number | null) ?? null,
    passes_key: (r.passes_key as number | null) ?? null,
    duels_total: (r.duels_total as number | null) ?? null,
    duels_won: (r.duels_won as number | null) ?? null,
  }));
}

export interface CalculateOptions extends GetPlayerLastMatchesOptions {
  playerId: string;
  apiPlayerId: number;
  teamId?: string | null;
}

export async function calculatePlayerRecentForm(
  options: CalculateOptions
): Promise<PlayerRecentForm> {
  const matches = await getPlayerLastMatches(options.apiPlayerId, options);
  const n = matches.length;

  const sum = (k: keyof PlayerStatRow): number =>
    matches.reduce((a, m) => a + (Number(m[k] ?? 0) || 0), 0);

  const cardsTotal = sum("yellow_cards") + sum("red_cards");
  const duelsLost = sum("duels_total") - sum("duels_won");

  return {
    player_id: options.playerId,
    api_player_id: options.apiPlayerId,
    team_id: options.teamId ?? null,
    sample_size: n,
    minutes_avg: roundDecimal(safeDivide(sum("minutes"), n, 0), 2),
    shots_avg: roundDecimal(safeDivide(sum("shots_total"), n, 0), 3),
    shots_on_avg: roundDecimal(safeDivide(sum("shots_on"), n, 0), 3),
    fouls_committed_avg: roundDecimal(safeDivide(sum("fouls_committed"), n, 0), 3),
    fouls_drawn_avg: roundDecimal(safeDivide(sum("fouls_drawn"), n, 0), 3),
    tackles_avg: roundDecimal(safeDivide(sum("tackles_total"), n, 0), 3),
    interceptions_avg: roundDecimal(safeDivide(sum("interceptions"), n, 0), 3),
    cards_avg: roundDecimal(safeDivide(cardsTotal, n, 0), 3),
    key_passes_avg: roundDecimal(safeDivide(sum("passes_key"), n, 0), 3),
    // Coluna `crosses` não existe em football_player_match_stats da 003.
    // Placeholder neutro até /fixtures/players entregar passes.cross.
    crosses_avg: 0,
    duels_won_avg: roundDecimal(safeDivide(sum("duels_won"), n, 0), 3),
    duels_lost_avg: roundDecimal(safeDivide(Math.max(0, duelsLost), n, 0), 3),
  };
}

export async function upsertPlayerRecentForm(
  form: PlayerRecentForm
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("football_player_recent_form")
    .upsert(
      { ...form, calculated_at: new Date().toISOString() },
      { onConflict: "player_id" }
    );
  if (error) throw new Error(`upsertPlayerRecentForm: ${error.message}`);
}
