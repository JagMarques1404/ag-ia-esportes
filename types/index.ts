// Types principais do sistema

export type Tier = "segura" | "intermediaria" | "avancada" | "mega_sena" | "dobra_do_dia";
export type BetType = "single" | "multiple" | "system";
export type BetStatus = "open" | "won" | "lost" | "cashed_out" | "void" | "partial";
export type LegResult = "pending" | "won" | "lost" | "void" | "half_won" | "half_lost";
export type ProtectionMode = "normal" | "strict" | "paused";

export interface FrameworkSettings {
  user_id: string;
  max_stake_pct: number;
  daily_limit_pct: number;
  stop_loss_pct: number;
  stop_win_pct: number;
  timeout_after_losses: number;
  timeout_minutes: number;
  block_after_stop_loss_hours: number;
  max_bets_per_day: number;
  protection_mode: ProtectionMode;
}

export interface Bankroll {
  user_id: string;
  current_balance: number;
  starting_balance: number;
  total_deposited: number;
  total_withdrawn: number;
  total_staked: number;
  total_returned: number;
  blocked_until: string | null;
  block_reason: string | null;
  current_streak_type: "win" | "loss" | "none";
  current_streak_count: number;
}

export interface Bet {
  id: string;
  user_id: string;
  bet_type: BetType;
  tier: Tier;
  total_stake: number;
  combined_odd: number;
  potential_return: number;
  estimated_prob_pct: number | null;
  estimated_ev_pct: number | null;
  bookmaker: string | null;
  notes: string | null;
  status: BetStatus;
  result_value: number;
  placed_at: string;
  settled_at: string | null;
  was_recommended: boolean;
  followed_framework: boolean;
  legs?: BetLeg[];
}

export interface BetLeg {
  id: string;
  bet_id: string;
  competition: string;
  home_team: string;
  away_team: string;
  game_date: string | null;
  market_type: string;
  selection: string;
  odd_value: number;
  estimated_prob_pct: number | null;
  result: LegResult;
  position: number;
}

export interface DashboardData {
  user_id: string;
  current_balance: number;
  starting_balance: number;
  total_deposited: number;
  total_staked: number;
  total_returned: number;
  current_streak_type: "win" | "loss" | "none";
  current_streak_count: number;
  blocked_until: string | null;
  lifetime_roi_pct: number;
  lifetime_pnl: number;
  bets_today: number;
  staked_today: number;
  pnl_today: number;
  roi_today: number;
  open_bets_count: number;
  open_bets_stake: number;
}

export interface RoiByDimension {
  total_bets: number;
  bets_won: number;
  bets_lost: number;
  total_staked: number;
  total_returned: number;
  net_pnl: number;
  roi_pct: number;
}

export interface FrameworkCheck {
  status: "green" | "yellow" | "red";
  can_bet: boolean;
  reason?: string;
  warnings: string[];
  stake_remaining_today: number;
  bets_remaining_today: number;
}

// ============================================================
// Intelligence schema (migration 003)
// Tipos espelham as tabelas football_* do Supabase.
// JSON colunas ficam como `unknown` aqui — os campos
// estruturados de domínio vivem em lib/ag-ia-esportes/types.ts.
// ============================================================

export interface FootballLeague {
  id: string;
  api_league_id: number | null;
  name: string;
  country: string | null;
  type: string | null;
  logo: string | null;
  season: number | null;
  priority: number;
  active: boolean;
  raw_json: unknown;
  created_at: string;
  updated_at: string;
}

export interface FootballTeam {
  id: string;
  api_team_id: number | null;
  name: string;
  country: string | null;
  logo: string | null;
  venue_name: string | null;
  raw_json: unknown;
  created_at: string;
  updated_at: string;
}

export interface FootballPlayer {
  id: string;
  api_player_id: number | null;
  name: string;
  firstname: string | null;
  lastname: string | null;
  age: number | null;
  birth_date: string | null;
  nationality: string | null;
  height: string | null;
  weight: string | null;
  photo: string | null;
  preferred_position: string | null;
  dominant_foot: string | null;
  current_team_id: string | null;
  raw_json: unknown;
  created_at: string;
  updated_at: string;
}

export interface FootballFixture {
  id: string;
  api_fixture_id: number | null;
  date: string;
  kickoff_at: string | null;
  timezone: string | null;
  league_id: string | null;
  api_league_id: number | null;
  league_name: string | null;
  season: number | null;
  round: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  api_home_team_id: number | null;
  api_away_team_id: number | null;
  home_team_name: string | null;
  away_team_name: string | null;
  status: string | null;
  elapsed: number | null;
  goals_home: number | null;
  goals_away: number | null;
  venue_name: string | null;
  referee: string | null;
  importance_score: number;
  raw_json: unknown;
  created_at: string;
  updated_at: string;
}

export interface FootballTeamMatchStats {
  id: string;
  fixture_id: string | null;
  team_id: string | null;
  opponent_team_id: string | null;
  shots_total: number;
  shots_on: number;
  shots_off: number;
  blocked_shots: number;
  corners: number;
  fouls: number;
  yellow_cards: number;
  red_cards: number;
  possession: number | null;
  passes: number | null;
  passes_accurate: number | null;
  attacks: number | null;
  dangerous_attacks: number | null;
  raw_json: unknown;
  created_at: string;
  updated_at: string;
}

export interface FootballPlayerMatchStats {
  id: string;
  fixture_id: string | null;
  team_id: string | null;
  opponent_team_id: string | null;
  player_id: string | null;
  api_player_id: number | null;
  player_name: string | null;
  position: string | null;
  minutes: number;
  rating: number | null;
  shots_total: number;
  shots_on: number;
  goals: number;
  assists: number;
  passes_total: number;
  passes_key: number;
  tackles_total: number;
  interceptions: number;
  duels_total: number;
  duels_won: number;
  dribbles_attempts: number;
  dribbles_success: number;
  fouls_drawn: number;
  fouls_committed: number;
  yellow_cards: number;
  red_cards: number;
  raw_json: unknown;
  created_at: string;
  updated_at: string;
}

export interface FootballActionProbability {
  id: string;
  fixture_id: string | null;
  player_id: string | null;
  team_id: string | null;
  player_name: string | null;
  market_type: string;
  line: number;
  probability: number;
  confidence: string;
  sample_size: number;
  last_5_hit_rate: number | null;
  last_10_hit_rate: number | null;
  season_hit_rate: number | null;
  fair_odds: number | null;
  risk_level: string;
  reasoning: string | null;
  data_quality: string;
  raw_features_json: unknown;
  created_at: string;
  updated_at: string;
}

export interface FootballBettingRecommendation {
  id: string;
  fixture_id: string | null;
  title: string;
  tier: string;
  selections_json: unknown;
  combined_probability: number | null;
  fair_odds: number | null;
  market_odds: number | null;
  value_score: number | null;
  stake_suggestion: number | null;
  reasoning: string | null;
  risk_alerts_json: unknown;
  status: string;
  result: string | null;
  hit: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface FootballPostMatchReview {
  id: string;
  recommendation_id: string | null;
  fixture_id: string | null;
  result: string | null;
  hit: boolean | null;
  error_type: string | null;
  review_json: unknown;
  learning_notes: string | null;
  created_at: string;
}

export interface FootballSyncRun {
  id: string;
  provider: string;
  sync_type: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  requests_used: number;
  records_created: number;
  records_updated: number;
  error_message: string | null;
  metadata_json: unknown;
}
