import "@/lib/server-only-guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  clamp,
  poissonAtLeast,
  probabilityToFairOdd,
  roundDecimal,
} from "./math";
import type { FixtureFeatures } from "./fixture-features";

export type RiskLevel = "low" | "medium" | "high" | "mega";

export const MODEL_VERSION = "v0.1-baseline" as const;

export interface MarketProbability {
  fixture_id: string;
  api_fixture_id: number;
  market_key: string;
  market_label: string;
  selection: string;
  probability: number;
  fair_odd: number;
  confidence_score: number;
  data_quality_score: number;
  risk_level: RiskLevel;
  model_version: string;
  explanation_json: Record<string, unknown>;
}

// ============================================================
// Helpers
// ============================================================

export function classifyRiskLevel(
  probability: number,
  confidence: number
): RiskLevel {
  if (probability >= 0.7 && confidence >= 0.6) return "low";
  if (probability >= 0.55 && confidence >= 0.45) return "medium";
  if (probability >= 0.4) return "high";
  return "mega";
}

export interface MarketExplanation {
  reason: string;
  inputs: Record<string, number | string | null>;
  limitations: string[];
}

export function buildMarketExplanation(
  features: FixtureFeatures,
  reason: string,
  extra: Record<string, number | string | null> = {}
): MarketExplanation {
  const limitations: string[] = [];
  if (features.home_form_sample < 5) {
    limitations.push(
      `home sample baixo (${features.home_form_sample} jogos)`
    );
  }
  if (features.away_form_sample < 5) {
    limitations.push(
      `away sample baixo (${features.away_form_sample} jogos)`
    );
  }
  if (features.data_quality_score < 0.5) {
    limitations.push("data_quality < 0.5 — predição de baixa confiança");
  }
  return {
    reason,
    inputs: {
      home_sample: features.home_form_sample,
      away_sample: features.away_form_sample,
      expected_home_goals: features.expected_home_goals,
      expected_away_goals: features.expected_away_goals,
      expected_total_goals: features.expected_total_goals,
      data_quality_score: features.data_quality_score,
      confidence_score: features.confidence_score,
      ...extra,
    },
    limitations,
  };
}

function makeMarket(
  features: FixtureFeatures,
  market_key: string,
  market_label: string,
  selection: string,
  probability: number,
  reason: string,
  extra: Record<string, number | string | null> = {}
): MarketProbability {
  const p = clamp(probability, 0.01, 0.99);
  const conf = features.confidence_score;
  const explanation = buildMarketExplanation(features, reason, extra);
  return {
    fixture_id: features.fixture_id,
    api_fixture_id: features.api_fixture_id,
    market_key,
    market_label,
    selection,
    probability: roundDecimal(p, 4),
    fair_odd: probabilityToFairOdd(p),
    confidence_score: conf,
    data_quality_score: features.data_quality_score,
    risk_level: classifyRiskLevel(p, conf),
    model_version: MODEL_VERSION,
    explanation_json: {
      reason: explanation.reason,
      inputs: explanation.inputs,
      limitations: explanation.limitations,
    },
  };
}

// ============================================================
// Mercados v0.1
// ============================================================

export function calculateGoalMarketProbabilities(
  features: FixtureFeatures
): MarketProbability[] {
  const lambda = features.expected_total_goals;
  const out: MarketProbability[] = [];

  out.push(
    makeMarket(
      features,
      "over_05_goals",
      "Over 0.5 gols (jogo)",
      "yes",
      poissonAtLeast(lambda, 1),
      "Poisson(λ=expected_total_goals) P(X ≥ 1)",
      { lambda }
    )
  );
  out.push(
    makeMarket(
      features,
      "over_15_goals",
      "Over 1.5 gols (jogo)",
      "yes",
      poissonAtLeast(lambda, 2),
      "Poisson(λ=expected_total_goals) P(X ≥ 2)",
      { lambda }
    )
  );
  out.push(
    makeMarket(
      features,
      "over_25_goals",
      "Over 2.5 gols (jogo)",
      "yes",
      poissonAtLeast(lambda, 3),
      "Poisson(λ=expected_total_goals) P(X ≥ 3)",
      { lambda }
    )
  );

  return out;
}

export function calculateBttsProbability(
  features: FixtureFeatures
): MarketProbability {
  // P(home marca >= 1) * P(away marca >= 1) sob independência Poisson.
  const pHome = poissonAtLeast(features.expected_home_goals, 1);
  const pAway = poissonAtLeast(features.expected_away_goals, 1);
  const p = pHome * pAway;
  return makeMarket(
    features,
    "btts_yes",
    "Ambas marcam (BTTS)",
    "yes",
    p,
    "P(home≥1) × P(away≥1) sob independência Poisson",
    {
      p_home_scores: roundDecimal(pHome, 4),
      p_away_scores: roundDecimal(pAway, 4),
    }
  );
}

export function calculateTeamToScoreProbabilities(
  features: FixtureFeatures
): MarketProbability[] {
  return [
    makeMarket(
      features,
      "home_team_over_05_goals",
      "Mandante marca pelo menos 1 gol",
      "yes",
      poissonAtLeast(features.expected_home_goals, 1),
      "Poisson(λ=expected_home_goals) P(X ≥ 1)",
      { lambda_home: features.expected_home_goals }
    ),
    makeMarket(
      features,
      "away_team_over_05_goals",
      "Visitante marca pelo menos 1 gol",
      "yes",
      poissonAtLeast(features.expected_away_goals, 1),
      "Poisson(λ=expected_away_goals) P(X ≥ 1)",
      { lambda_away: features.expected_away_goals }
    ),
  ];
}

export function calculateFirstHalfGoalProbability(
  features: FixtureFeatures
): MarketProbability {
  // Sem stats de gols por tempo no banco ainda. Aproximação:
  // assume ~45% dos gols esperados no 1T (baseline empírico
  // global). Marcamos limitação no explanation.
  const lambdaFirstHalf = features.expected_total_goals * 0.45;
  const p = poissonAtLeast(lambdaFirstHalf, 1);
  return makeMarket(
    features,
    "first_half_over_05_goals",
    "Over 0.5 gols (1º tempo)",
    "yes",
    p,
    "Poisson com λ = 45% do total esperado (proxy global)",
    {
      lambda_first_half: roundDecimal(lambdaFirstHalf, 3),
      proxy_share: 0.45,
    }
  );
}

// ============================================================
// Orquestração
// ============================================================

export function calculateAllMarketProbabilities(
  features: FixtureFeatures
): MarketProbability[] {
  return [
    ...calculateGoalMarketProbabilities(features),
    calculateBttsProbability(features),
    ...calculateTeamToScoreProbabilities(features),
    calculateFirstHalfGoalProbability(features),
  ];
}

export async function upsertMarketProbabilities(
  rows: MarketProbability[]
): Promise<number> {
  if (rows.length === 0) return 0;
  const supabase = getSupabaseAdmin();
  const payload = rows.map((r) => ({
    ...r,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase
    .from("football_market_probabilities")
    .upsert(payload, {
      onConflict: "fixture_id,market_key,selection,model_version",
    });
  if (error) {
    throw new Error(`upsertMarketProbabilities: ${error.message}`);
  }
  return rows.length;
}
