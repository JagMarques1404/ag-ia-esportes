// ============================================================
// AG IA Esportes — Tipos de domínio
//
// Vocabulário compartilhado entre o motor de probabilidades,
// o gerador de bilhetes e a camada de persistência. Os tipos
// aqui não são espelho 1:1 das tabelas (esses ficam em
// types/index.ts) — são as estruturas que circulam dentro
// das funções de inteligência.
// ============================================================

/**
 * Mercados suportados pelo motor.
 * Mantenha sincronizado com MARKET_TYPES em constants.ts.
 */
export type MarketType =
  | "goals_over"
  | "goals_under"
  | "btts"
  | "double_chance"
  | "result_1x2"
  | "corners_over"
  | "corners_under"
  | "cards_over"
  | "cards_under"
  | "player_goal"
  | "player_assist"
  | "player_shots_over"
  | "player_shots_on_over"
  | "player_card"
  | "player_tackles_over"
  | "player_passes_over";

/**
 * Tiers de recomendação de aposta.
 */
export type RecommendationTier =
  | "segura"
  | "intermediaria"
  | "avancada"
  | "mega";

export type RiskLevel = "low" | "medium" | "high";

export type DataQuality = "high" | "medium" | "low" | "unknown";

export type ConfidenceLevel = "high" | "medium" | "low";

/**
 * Resumo dos últimos N jogos de um jogador, em termos de uma ação.
 * Ex.: para mercado player_shots_over com line=1.5, hits = jogos
 * em que o jogador teve mais de 1.5 finalizações.
 */
export interface PlayerLastGamesSummary {
  player_id: string;
  api_player_id?: number;
  market_type: MarketType;
  line: number;
  games_considered: number;
  hits: number;
  misses: number;
  hit_rate: number;
  values: number[];
  avg: number;
  median: number;
  stddev: number;
}

/**
 * Contexto de confronto direto (matchup) para ajustar
 * a probabilidade base do jogador.
 */
export interface MatchupContext {
  fixture_id: string;
  player_id: string;
  opponent_team_id: string;
  opponent_player_id?: string;
  matchup_type?: string;
  notes?: string;
  /** Ajuste em pontos percentuais (-100..+100). */
  probability_delta: number;
}

/**
 * Entrada agregada para o cálculo final de probabilidade.
 * Combina histórico + matchup + sinais externos (lineup, lesões).
 */
export interface ActionProbabilityInput {
  fixture_id: string;
  player_id?: string;
  team_id?: string;
  market_type: MarketType;
  line: number;
  last_games: PlayerLastGamesSummary;
  matchup?: MatchupContext;
  is_starting?: boolean;
  minutes_expected?: number;
  data_quality: DataQuality;
  notes?: string;
}

/**
 * Uma seleção dentro de uma recomendação.
 * Equivale a uma "perna" em uma múltipla.
 */
export interface BettingSelection {
  fixture_id: string;
  player_id?: string;
  team_id?: string;
  player_name?: string;
  market_type: MarketType;
  line: number;
  probability: number;
  fair_odds: number;
  market_odds?: number;
  reasoning?: string;
  risk_level: RiskLevel;
}

/**
 * Payload de uma recomendação antes de ser persistida em
 * football_betting_recommendations.
 */
export interface BettingRecommendationPayload {
  fixture_id: string;
  title: string;
  tier: RecommendationTier;
  selections: BettingSelection[];
  combined_probability: number;
  fair_odds: number;
  market_odds?: number;
  value_score?: number;
  stake_suggestion?: number;
  reasoning?: string;
  risk_alerts: string[];
}
