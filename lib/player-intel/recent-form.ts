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
  /**
   * Considera apenas jogos cujo kickoff_at < este timestamp ISO.
   * Mais preciso que beforeDate quando dois jogos caem no mesmo dia.
   */
  beforeKickoffAt?: string | null;
  /**
   * Exclui um fixture específico (uuid local) do histórico.
   * Anti data-leakage: o jogo que estamos prevendo NUNCA deve entrar
   * no recent_form do próprio jogador.
   */
  excludeFixtureId?: string;
}

interface PlayerStatRow {
  fixture_id: string;
  minutes: number | null;
  shots_total: number | null;
  shots_on: number | null;
  fouls_committed: number | null;
  fouls_drawn: number | null;
  goals: number | null;
  assists: number | null;
  offsides: number | null;
  blocks: number | null;
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
  const { limit = 5, beforeDate, beforeKickoffAt, excludeFixtureId } = options;
  // Guard: api_player_id 0/negativo é placeholder do provider —
  // jogadores diferentes seriam agrupados como o mesmo "atleta".
  if (!Number.isFinite(apiPlayerId) || apiPlayerId <= 0) return [];
  const supabase = getSupabaseAdmin();

  // INNER JOIN com football_fixtures para poder filtrar por data/kickoff.
  let query = supabase
    .from("football_player_match_stats")
    .select(
      "fixture_id, minutes, shots_total, shots_on, fouls_committed, fouls_drawn, goals, assists, offsides, blocks, tackles_total, interceptions, yellow_cards, red_cards, passes_total, passes_key, duels_total, duels_won, football_fixtures!inner(date, kickoff_at, status)"
    )
    .eq("api_player_id", apiPlayerId)
    .in("football_fixtures.status", ["FT", "AET", "PEN"])
    .order("created_at", { ascending: false })
    .limit(limit);

  // Anti data-leakage: nunca usar o próprio fixture analisado.
  if (excludeFixtureId) {
    query = query.neq("fixture_id", excludeFixtureId);
  }
  // beforeKickoffAt é mais preciso que beforeDate (mesmo dia, jogos
  // diferentes). Se ambos vierem, aplica os dois.
  if (beforeKickoffAt) {
    query = query.lt("football_fixtures.kickoff_at", beforeKickoffAt);
  }
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
    goals: (r.goals as number | null) ?? null,
    assists: (r.assists as number | null) ?? null,
    offsides: (r.offsides as number | null) ?? null,
    blocks: (r.blocks as number | null) ?? null,
    tackles_total: (r.tackles_total as number | null) ?? null,
    interceptions: (r.interceptions as number | null) ?? null,
    yellow_cards: (r.yellow_cards as number | null) ?? null,
    red_cards: (r.red_cards as number | null) ?? null,
    passes_key: (r.passes_key as number | null) ?? null,
    duels_total: (r.duels_total as number | null) ?? null,
    duels_won: (r.duels_won as number | null) ?? null,
  }));
}

// ============================================================
// Last 5 por ação — versão "valores brutos" (não só média)
// ============================================================

export type Last5Action =
  | "shot"
  | "shot_on"
  | "foul_committed"
  | "foul_drawn"
  | "tackle"
  | "yellow_card"
  | "red_card"
  | "offside"
  | "goal"
  | "assist"
  | "key_pass"
  | "block";

export interface PlayerLast5Series {
  api_player_id: number;
  action_key: Last5Action;
  values_last_5: number[];
  sample_size: number;
  avg_value: number;
  hit_rate_over_0_5: number; // % de jogos com valor ≥ 1
  hit_rate_over_1_5: number; // % de jogos com valor ≥ 2
  hit_rate_over_2_5: number; // % de jogos com valor ≥ 3
  minutes_avg: number;
  last_fixture_ids: string[];
  data_quality_score: number;
  data_origin: "db" | "contextual";
}

const ACTION_TO_COLUMN: Record<Last5Action, keyof PlayerStatRow> = {
  shot: "shots_total",
  shot_on: "shots_on",
  foul_committed: "fouls_committed",
  foul_drawn: "fouls_drawn",
  tackle: "tackles_total",
  yellow_card: "yellow_cards",
  red_card: "red_cards",
  offside: "offsides",
  goal: "goals",
  assist: "assists",
  key_pass: "passes_key",
  block: "blocks",
};

function dataQualityFromSample(n: number): number {
  if (n <= 1) return 0.2;
  if (n <= 3) return 0.5;
  return 0.8;
}

function hitRateAtLeast(values: number[], threshold: number): number {
  if (values.length === 0) return 0;
  const hits = values.filter((v) => v >= threshold).length;
  return roundDecimal(hits / values.length, 4);
}

/**
 * Série dos últimos N (default 5) jogos do jogador para uma ação
 * específica. Retorna valores brutos por jogo + sample_size +
 * hit_rates por linha (0.5 / 1.5 / 2.5).
 *
 * Usa apenas dados do banco. Sem chamada externa. Anti data-leakage:
 * o caller deve passar `beforeKickoffAt` (ou `excludeFixtureId`) do
 * fixture sendo previsto.
 */
export async function getPlayerLast5ActionSeries(
  apiPlayerId: number,
  actionKey: Last5Action,
  options: GetPlayerLastMatchesOptions = {}
): Promise<PlayerLast5Series> {
  const matches = await getPlayerLastMatches(apiPlayerId, {
    limit: options.limit ?? 5,
    beforeDate: options.beforeDate,
    beforeKickoffAt: options.beforeKickoffAt,
    excludeFixtureId: options.excludeFixtureId,
  });

  const col = ACTION_TO_COLUMN[actionKey];
  const values_last_5 = matches.map((m) => Number(m[col] ?? 0) || 0);
  const minutes = matches.map((m) => Number(m.minutes ?? 0) || 0);
  const sample_size = matches.length;
  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

  return {
    api_player_id: apiPlayerId,
    action_key: actionKey,
    values_last_5,
    sample_size,
    avg_value:
      sample_size > 0
        ? roundDecimal(safeDivide(sum(values_last_5), sample_size, 0), 3)
        : 0,
    hit_rate_over_0_5: hitRateAtLeast(values_last_5, 1),
    hit_rate_over_1_5: hitRateAtLeast(values_last_5, 2),
    hit_rate_over_2_5: hitRateAtLeast(values_last_5, 3),
    minutes_avg:
      sample_size > 0
        ? roundDecimal(safeDivide(sum(minutes), sample_size, 0), 2)
        : 0,
    last_fixture_ids: matches.map((m) => m.fixture_id),
    data_quality_score: dataQualityFromSample(sample_size),
    data_origin: sample_size > 0 ? "db" : "contextual",
  };
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
