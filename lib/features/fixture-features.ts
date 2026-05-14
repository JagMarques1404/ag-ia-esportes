import "@/lib/server-only-guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  calculateTeamRecentForm,
  type TeamRecentFormResult,
} from "./team-form";
import { clamp, roundDecimal, weightedAverage } from "./math";

export interface FixtureFeatures {
  fixture_id: string;
  api_fixture_id: number;
  home_team_id: string;
  away_team_id: string;
  league_id: string | null;
  date: string;
  kickoff_at: string | null;
  home_form_sample: number;
  away_form_sample: number;
  home_avg_goals_for: number;
  home_avg_goals_against: number;
  away_avg_goals_for: number;
  away_avg_goals_against: number;
  expected_home_goals: number;
  expected_away_goals: number;
  expected_total_goals: number;
  expected_btts_score: number;
  pace_score: number;
  volatility_score: number;
  data_quality_score: number;
  confidence_score: number;
  /** Não persistido — útil para a probability engine. */
  home_form?: TeamRecentFormResult;
  away_form?: TeamRecentFormResult;
}

interface FixtureRow {
  id: string;
  api_fixture_id: number;
  date: string;
  kickoff_at: string | null;
  league_id: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  api_home_team_id: number | null;
  api_away_team_id: number | null;
}

// ============================================================
// Helpers de cálculo (puros)
// ============================================================

/**
 * Expected goals baseline:
 *   λ_home = média(home.goals_for_pro_jogo, away.goals_against_pro_jogo)
 *   λ_away = média(away.goals_for_pro_jogo, home.goals_against_pro_jogo)
 *
 * Sem ajuste por liga ainda. Para v0.1 é honesto e transparente.
 */
export function calculateExpectedGoals(
  home: TeamRecentFormResult,
  away: TeamRecentFormResult
): { expectedHome: number; expectedAway: number; expectedTotal: number } {
  const expectedHome = roundDecimal(
    (home.avg_goals_for + away.avg_goals_against) / 2,
    3
  );
  const expectedAway = roundDecimal(
    (away.avg_goals_for + home.avg_goals_against) / 2,
    3
  );
  return {
    expectedHome,
    expectedAway,
    expectedTotal: roundDecimal(expectedHome + expectedAway, 3),
  };
}

/**
 * Pace = média ponderada das taxas históricas de over 1.5 dos dois times.
 * Útil como sinal cruzado para sanidade da Poisson.
 */
export function calculatePaceScore(
  home: TeamRecentFormResult,
  away: TeamRecentFormResult
): number {
  return roundDecimal(
    weightedAverage([
      { value: home.over_15_goals_rate, weight: home.sample_size },
      { value: away.over_15_goals_rate, weight: away.sample_size },
    ]),
    4
  );
}

/**
 * Volatility = dispersão entre over_05 e over_25. Quanto maior, mais
 * imprevisível foi historicamente — sinal para reduzir confidence.
 */
export function calculateVolatilityScore(
  home: TeamRecentFormResult,
  away: TeamRecentFormResult
): number {
  const homeRange = Math.abs(home.over_05_goals_rate - home.over_25_goals_rate);
  const awayRange = Math.abs(away.over_05_goals_rate - away.over_25_goals_rate);
  // Quanto mais próximas as taxas, maior a previsibilidade. Inverter
  // para que volatility alta = menos previsível.
  return roundDecimal((homeRange + awayRange) / 2, 4);
}

/**
 * Data quality: combina sample size dos dois times.
 *   sample 0-2 → 0.20
 *   sample 3-4 → 0.50
 *   sample 5+  → 0.90
 * Resultado é a média dos dois lados.
 */
export function calculateDataQualityScore(
  homeSample: number,
  awaySample: number
): number {
  function bucket(n: number): number {
    if (n <= 2) return 0.2;
    if (n <= 4) return 0.5;
    return 0.9;
  }
  return roundDecimal((bucket(homeSample) + bucket(awaySample)) / 2, 3);
}

/**
 * Confidence = data quality × (1 - volatility/2). Sem outras features
 * ainda, fica simples mas explicável.
 */
function calculateConfidence(
  dataQuality: number,
  volatility: number
): number {
  return roundDecimal(clamp(dataQuality * (1 - volatility / 2), 0, 1), 4);
}

/**
 * BTTS expected score = produto das taxas "marcou" e "sofreu" cruzadas.
 * É só um sinal — não é a probabilidade BTTS final (essa fica na
 * probability-engine).
 */
function calculateBttsExpected(
  home: TeamRecentFormResult,
  away: TeamRecentFormResult
): number {
  const homeScores = home.scored_rate;
  const awayConcedes = away.conceded_rate;
  const awayScores = away.scored_rate;
  const homeConcedes = home.conceded_rate;
  return roundDecimal(
    (homeScores * awayConcedes + awayScores * homeConcedes) / 2,
    4
  );
}

// ============================================================
// Persistência + orquestração
// ============================================================

export async function calculateFixtureFeatures(
  fixtureId: string
): Promise<FixtureFeatures> {
  const supabase = getSupabaseAdmin();

  const { data: fx, error } = await supabase
    .from("football_fixtures")
    .select(
      "id, api_fixture_id, date, kickoff_at, league_id, home_team_id, away_team_id, api_home_team_id, api_away_team_id"
    )
    .eq("id", fixtureId)
    .maybeSingle<FixtureRow>();

  if (error) {
    throw new Error(`calculateFixtureFeatures: ${error.message}`);
  }
  if (!fx) {
    throw new Error(`Fixture não encontrada: ${fixtureId}`);
  }
  if (!fx.home_team_id || !fx.away_team_id) {
    throw new Error(
      `Fixture ${fixtureId} sem home_team_id/away_team_id resolvido`
    );
  }
  if (!fx.api_home_team_id || !fx.api_away_team_id) {
    throw new Error(
      `Fixture ${fixtureId} sem api_home_team_id/api_away_team_id`
    );
  }

  // Calcular form dos dois times — usa apenas jogos anteriores à data.
  const homeForm = await calculateTeamRecentForm({
    teamId: fx.home_team_id,
    apiTeamId: fx.api_home_team_id,
    scope: "overall",
    beforeDate: fx.date,
    limit: 5,
  });
  const awayForm = await calculateTeamRecentForm({
    teamId: fx.away_team_id,
    apiTeamId: fx.api_away_team_id,
    scope: "overall",
    beforeDate: fx.date,
    limit: 5,
  });

  const { expectedHome, expectedAway, expectedTotal } = calculateExpectedGoals(
    homeForm,
    awayForm
  );
  const pace = calculatePaceScore(homeForm, awayForm);
  const volatility = calculateVolatilityScore(homeForm, awayForm);
  const dq = calculateDataQualityScore(
    homeForm.sample_size,
    awayForm.sample_size
  );
  const conf = calculateConfidence(dq, volatility);
  const bttsExpected = calculateBttsExpected(homeForm, awayForm);

  return {
    fixture_id: fx.id,
    api_fixture_id: fx.api_fixture_id,
    home_team_id: fx.home_team_id,
    away_team_id: fx.away_team_id,
    league_id: fx.league_id,
    date: fx.date,
    kickoff_at: fx.kickoff_at,
    home_form_sample: homeForm.sample_size,
    away_form_sample: awayForm.sample_size,
    home_avg_goals_for: homeForm.avg_goals_for,
    home_avg_goals_against: homeForm.avg_goals_against,
    away_avg_goals_for: awayForm.avg_goals_for,
    away_avg_goals_against: awayForm.avg_goals_against,
    expected_home_goals: expectedHome,
    expected_away_goals: expectedAway,
    expected_total_goals: expectedTotal,
    expected_btts_score: bttsExpected,
    pace_score: pace,
    volatility_score: volatility,
    data_quality_score: dq,
    confidence_score: conf,
    home_form: homeForm,
    away_form: awayForm,
  };
}

export async function upsertFixtureFeatures(
  features: FixtureFeatures
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { home_form: _h, away_form: _a, ...persistable } = features;
  void _h;
  void _a;

  const { error } = await supabase
    .from("football_fixture_features")
    .upsert(
      { ...persistable, updated_at: new Date().toISOString() },
      { onConflict: "fixture_id" }
    );
  if (error) {
    throw new Error(`upsertFixtureFeatures: ${error.message}`);
  }
}
