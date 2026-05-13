// ============================================================
// AG IA Esportes — Constantes de domínio
//
// Listas canônicas de mercados, tiers e thresholds que o motor
// de probabilidades e o gerador de bilhetes consultam.
// Alteração aqui afeta validação e UI.
// ============================================================

import type {
  ConfidenceLevel,
  DataQuality,
  MarketType,
  RecommendationTier,
  RiskLevel,
} from "./types";

/**
 * Mercados suportados.
 * Manter sincronizado com o type MarketType.
 */
export const MARKET_TYPES = [
  "goals_over",
  "goals_under",
  "btts",
  "double_chance",
  "result_1x2",
  "corners_over",
  "corners_under",
  "cards_over",
  "cards_under",
  "player_goal",
  "player_assist",
  "player_shots_over",
  "player_shots_on_over",
  "player_card",
  "player_tackles_over",
  "player_passes_over",
] as const satisfies readonly MarketType[];

/**
 * Tiers de recomendação, em ordem crescente de risco.
 */
export const RECOMMENDATION_TIERS = [
  "segura",
  "intermediaria",
  "avancada",
  "mega",
] as const satisfies readonly RecommendationTier[];

export const RISK_LEVELS = [
  "low",
  "medium",
  "high",
] as const satisfies readonly RiskLevel[];

export const DATA_QUALITY_LEVELS = [
  "high",
  "medium",
  "low",
  "unknown",
] as const satisfies readonly DataQuality[];

export const CONFIDENCE_LEVELS = [
  "high",
  "medium",
  "low",
] as const satisfies readonly ConfidenceLevel[];

/**
 * Thresholds default para classificar uma probabilidade
 * combinada em um tier. O motor pode sobrescrever por usuário.
 *
 * Lê-se: prob >= 0.55 → segura, prob >= 0.30 → intermediaria, etc.
 */
export const DEFAULT_PROBABILITY_THRESHOLDS: Record<RecommendationTier, number> = {
  segura: 0.55,
  intermediaria: 0.30,
  avancada: 0.10,
  mega: 0.0,
};
