import "@/lib/server-only-guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  clamp,
  poissonAtLeast,
  probabilityToFairOdd,
  roundDecimal,
} from "@/lib/features/math";
import type { Archetype } from "./archetypes";
import type { PlayerRecentForm, PlayerLast5Series } from "./recent-form";
import type { DirectMatchup } from "./matchups";

/**
 * Ações suportadas no Player Action Board v1.
 * `cross` e `aerial_duel` foram OMITIDAS porque o endpoint free do
 * provider não entrega dado confiável nessas dimensões.
 */
export const PLAYER_ACTIONS = [
  "shot",
  "shot_on",
  "foul_committed",
  "foul_drawn",
  "tackle",
  "yellow_card",
  "red_card",
  "offside",
  "goal",
  "assist",
  "key_pass",
  "block",
] as const;
export type PlayerAction = (typeof PLAYER_ACTIONS)[number];

export const ACTION_LABELS: Record<PlayerAction, string> = {
  shot: "Finalização (qualquer)",
  shot_on: "Finalização no gol",
  foul_committed: "Falta cometida",
  foul_drawn: "Falta sofrida",
  tackle: "Desarme",
  yellow_card: "Cartão amarelo",
  red_card: "Cartão vermelho",
  offside: "Impedimento",
  goal: "Gol",
  assist: "Assistência",
  key_pass: "Passe chave",
  block: "Bloqueio (defensivo)",
};

export const MODEL_VERSION = "player-intel-v0.2" as const;

export type Recommendation = "forte" | "monitorar" | "evitar";
export type DataOrigin =
  | "api"
  | "db"
  | "manual"
  | "contextual"
  | "mock"
  | "missing";

export interface PlayerActionProbability {
  fixture_id: string;
  api_fixture_id: number;
  player_id: string | null;
  api_player_id: number | null;
  player_name: string;
  team_id: string | null;
  opponent_team_id: string | null;
  action_key: PlayerAction;
  action_label: string;
  line: number;
  probability: number;
  fair_odd: number;
  confidence_score: number;
  data_quality_score: number;
  matchup_score: number;
  model_version: typeof MODEL_VERSION;
  explanation_json: Record<string, unknown>;
  // Migration 011 — board fields
  odd_market: number | null;
  last5_values: number[];
  sample_size: number;
  hit_rate: number | null;
  avg_value: number | null;
  edge: number | null;
  recommendation: Recommendation;
  data_origin: DataOrigin;
  line_label: string | null;
  rationale: string | null;
}

// ============================================================
// Helpers
// ============================================================

function dataQualityFromSample(n: number): number {
  if (n <= 1) return 0.2;
  if (n <= 3) return 0.5;
  return 0.8;
}

/**
 * Base λ por ação a partir das médias agregadas (PlayerRecentForm).
 * Usado SOMENTE como fallback quando não há série dos últimos 5.
 * Quando o caller passar `series` (PlayerLast5Series), preferimos
 * `series.avg_value` — é a base mais precisa.
 *
 * Para ações que não têm coluna agregada em PlayerRecentForm
 * (yellow_card/red_card/offside/goal/assist/block), retornamos 0.
 * Sem série, a probabilidade derivada cai automaticamente no
 * hard-cap por sample baixo.
 */
function baseLambdaFromForm(
  form: PlayerRecentForm,
  action: PlayerAction
): number {
  switch (action) {
    case "shot":
      return form.shots_avg;
    case "shot_on":
      return form.shots_on_avg;
    case "foul_committed":
      return form.fouls_committed_avg;
    case "foul_drawn":
      return form.fouls_drawn_avg;
    case "tackle":
      return form.tackles_avg;
    case "key_pass":
      return form.key_passes_avg;
    case "yellow_card":
      // form.cards_avg agrega yellow+red. Aproximamos yellow ≈ 95%.
      return form.cards_avg * 0.95;
    case "red_card":
      return form.cards_avg * 0.05;
    case "offside":
    case "goal":
    case "assist":
    case "block":
      return 0;
  }
}

function hitRateAtLineFromSeries(
  series: PlayerLast5Series | undefined,
  line: number
): number | null {
  if (!series || series.values_last_5.length === 0) return null;
  const k = Math.max(1, Math.ceil(line + 0.5));
  if (k <= 1) return series.hit_rate_over_0_5;
  if (k <= 2) return series.hit_rate_over_1_5;
  if (k <= 3) return series.hit_rate_over_2_5;
  // Para linhas mais altas, calcula on-the-fly.
  const hits = series.values_last_5.filter((v) => v >= k).length;
  return roundDecimal(hits / series.values_last_5.length, 4);
}

function recommend(args: {
  sample_size: number;
  probability: number;
  data_quality: number;
  hit_rate: number | null;
  edge: number | null;
}): Recommendation {
  const { sample_size, probability, data_quality, hit_rate, edge } = args;
  // Evitar: dado insuficiente, ou prob baixa, ou edge negativo
  if (sample_size <= 1) return "evitar";
  if (probability < 0.4) return "evitar";
  if (edge != null && edge < 0) return "evitar";
  // Forte: tudo positivo
  const hitOk = hit_rate == null ? true : hit_rate >= 0.6;
  if (
    sample_size >= 3 &&
    probability >= 0.6 &&
    data_quality >= 0.5 &&
    hitOk
  ) {
    return "forte";
  }
  return "monitorar";
}

/**
 * Ajuste de matchup: bonus/penalidade em pontos percentuais sobre a
 * probabilidade base. Heurísticas v0.1, explicáveis e conservadoras.
 *
 * Convenção: retorna 0 a +0.15 quando o oponente FAVORECE a ação,
 * 0 a -0.15 quando o oponente DIFICULTA.
 */
function matchupAdjustment(
  action: PlayerAction,
  myArchetype: Archetype | null,
  oppArchetype: Archetype | null
): { delta: number; reason: string } {
  if (!myArchetype || !oppArchetype) {
    return { delta: 0, reason: "sem arquétipos definidos (sample baixo)" };
  }
  // Foul drawn por driblador vs zagueiro agressivo / faltoso.
  if (
    action === "foul_drawn" &&
    (myArchetype === "winger_dribbler" || myArchetype === "ball_carrier") &&
    (oppArchetype === "aggressive_defender" || oppArchetype === "foul_committer")
  ) {
    return { delta: 0.12, reason: `${myArchetype} vs ${oppArchetype}` };
  }
  // Foul committed/cartão por zagueiro agressivo vs driblador.
  if (
    (action === "foul_committed" ||
      action === "yellow_card" ||
      action === "red_card") &&
    (myArchetype === "aggressive_defender" || myArchetype === "foul_committer") &&
    (oppArchetype === "winger_dribbler" || oppArchetype === "ball_carrier")
  ) {
    return { delta: 0.10, reason: `${myArchetype} marca ${oppArchetype}` };
  }
  // Tackle/interception por ball_winner vs playmaker.
  if (
    action === "tackle" &&
    myArchetype === "ball_winner" &&
    (oppArchetype === "playmaker" || oppArchetype === "ball_carrier")
  ) {
    return { delta: 0.08, reason: "ball_winner vs criador" };
  }
  // Shot by finisher vs defesa frágil aérea (sem proxy ainda).
  if (action === "shot_on" && myArchetype === "striker_finisher") {
    return { delta: 0.04, reason: "finalizador vs zaga (proxy fraco)" };
  }
  return { delta: 0, reason: "matchup neutro" };
}

/**
 * Ajuste por minutagem esperada. Titular = 1.0, banco = 0.4.
 */
function minutesAdjustment(isStarting: boolean): {
  factor: number;
  reason: string;
} {
  return isStarting
    ? { factor: 1.0, reason: "titular" }
    : { factor: 0.4, reason: "banco" };
}

// ============================================================
// Cálculo principal
// ============================================================

export interface CalculateInput {
  fixtureId: string;
  apiFixtureId: number;
  player: {
    player_id: string | null;
    api_player_id: number | null;
    player_name: string;
    team_id: string | null;
    is_starting: boolean;
  };
  opponentTeamId: string | null;
  form: PlayerRecentForm;
  matchup: DirectMatchup | null;
  /** Série dos últimos jogos para esta ação (preferido se presente). */
  series?: PlayerLast5Series;
  /** Odd de mercado para esta linha (se conhecida pelo caller). */
  oddMarket?: number | null;
}

function lineLabelFor(action: PlayerAction, line: number): string {
  const k = Math.max(1, Math.ceil(line + 0.5));
  if (action === "yellow_card" || action === "red_card") {
    return k === 1 ? "leva cartão" : `leva ≥ ${k} cartões`;
  }
  if (action === "goal") return k === 1 ? "marca a qualquer momento" : `≥ ${k} gols`;
  if (action === "assist") return k === 1 ? "dá assistência" : `≥ ${k} assistências`;
  return `≥ ${k} ${ACTION_LABELS[action].toLowerCase()}`;
}

export function calculatePlayerActionProbability(
  input: CalculateInput,
  action: PlayerAction,
  line = 0.5
): PlayerActionProbability {
  const { player, form, matchup, series, oddMarket } = input;

  // Sample efetivo: preferir series.sample_size se disponível
  // (mais granular por ação) — senão cai no agregado de form.
  const sampleSize = series?.sample_size ?? form.sample_size;
  const dq = series?.data_quality_score ?? dataQualityFromSample(sampleSize);

  // Base λ: prefere série específica da ação; fallback no form
  const baseLam = series ? series.avg_value : baseLambdaFromForm(form, action);
  const mAdj = matchupAdjustment(
    action,
    matchup?.player_archetype ?? null,
    matchup?.opponent_archetype ?? null
  );
  const minAdj = minutesAdjustment(player.is_starting);

  // λ ajustado por minutagem; matchup entra como delta na prob final.
  const adjustedLambda = baseLam * minAdj.factor;
  const k = Math.max(1, Math.ceil(line + 0.5));
  const baseProb = poissonAtLeast(adjustedLambda, k);
  let finalProb = clamp(baseProb + mAdj.delta, 0.01, 0.99);

  // ANTI-OVERCONFIDENCE: sample baixo nunca deve gerar pick forte.
  const lowSampleHardCap =
    sampleSize === 0 ? 0.10 : sampleSize < 2 ? 0.35 : null;
  let lowSampleNote: string | null = null;
  if (lowSampleHardCap !== null && finalProb > lowSampleHardCap) {
    finalProb = lowSampleHardCap;
    lowSampleNote = `sample_size=${sampleSize} — probabilidade limitada a ${lowSampleHardCap.toFixed(2)} por segurança`;
  } else if (lowSampleHardCap !== null) {
    lowSampleNote = `sample_size=${sampleSize} — prob abaixo do hard-cap, mantida`;
  }

  // Confidence = data_quality × (1 - |delta_matchup|*2)
  const confidence = roundDecimal(
    clamp(dq * (1 - Math.min(0.5, Math.abs(mAdj.delta) * 2)), 0, 1),
    4
  );

  // Hit rate na linha (ex.: para line=2.5 → % jogos com ≥ 3)
  const hitRate = hitRateAtLineFromSeries(series, line);

  // Edge contra odd de mercado (se conhecida)
  const edge =
    oddMarket != null && oddMarket > 1
      ? roundDecimal(finalProb * oddMarket - 1, 4)
      : null;

  const recommendation = recommend({
    sample_size: sampleSize,
    probability: finalProb,
    data_quality: dq,
    hit_rate: hitRate,
    edge,
  });

  // Origem do dado: db quando temos histórico real; contextual quando 0.
  const dataOrigin: DataOrigin = sampleSize > 0 ? "db" : "contextual";

  // Racional curto e legível (humano lê)
  const rationaleParts: string[] = [];
  if (series && series.values_last_5.length > 0) {
    rationaleParts.push(
      `últimos ${series.values_last_5.length}: [${series.values_last_5.join(", ")}], média ${series.avg_value}`
    );
  } else {
    rationaleParts.push(`sem histórico (sample=${sampleSize})`);
  }
  if (mAdj.delta !== 0) {
    rationaleParts.push(
      `matchup ${mAdj.delta > 0 ? "+" : ""}${(mAdj.delta * 100).toFixed(0)}pp (${mAdj.reason})`
    );
  }
  if (edge != null) {
    rationaleParts.push(
      `edge vs odd ${oddMarket}: ${edge >= 0 ? "+" : ""}${(edge * 100).toFixed(1)}%`
    );
  }
  const rationale = rationaleParts.join(" · ");

  return {
    fixture_id: input.fixtureId,
    api_fixture_id: input.apiFixtureId,
    player_id: player.player_id,
    api_player_id: player.api_player_id,
    player_name: player.player_name,
    team_id: player.team_id,
    opponent_team_id: input.opponentTeamId,
    action_key: action,
    action_label: ACTION_LABELS[action],
    line,
    probability: roundDecimal(finalProb, 4),
    fair_odd: probabilityToFairOdd(finalProb),
    confidence_score: confidence,
    data_quality_score: dq,
    matchup_score: roundDecimal(mAdj.delta, 4),
    model_version: MODEL_VERSION,
    explanation_json: {
      action,
      line,
      base_lambda: roundDecimal(baseLam, 4),
      adjusted_lambda: roundDecimal(adjustedLambda, 4),
      base_probability: roundDecimal(baseProb, 4),
      matchup_delta: roundDecimal(mAdj.delta, 4),
      matchup_reason: mAdj.reason,
      minutes_factor: minAdj.factor,
      minutes_reason: minAdj.reason,
      sample_size: sampleSize,
      hit_rate: hitRate,
      avg_value: series?.avg_value ?? null,
      values_last_5: series?.values_last_5 ?? [],
      limitations: [
        ...(lowSampleNote ? [lowSampleNote] : []),
        ...(sampleSize < 4
          ? [`sample_size=${sampleSize} < 4 — confiança limitada`]
          : []),
      ],
    },
    odd_market: oddMarket ?? null,
    last5_values: series?.values_last_5 ?? [],
    sample_size: sampleSize,
    hit_rate: hitRate,
    avg_value: series?.avg_value ?? null,
    edge,
    recommendation,
    data_origin: dataOrigin,
    line_label: lineLabelFor(action, line),
    rationale,
  };
}

export async function upsertPlayerActionProbabilities(
  rows: PlayerActionProbability[]
): Promise<number> {
  if (rows.length === 0) return 0;
  const supabase = getSupabaseAdmin();

  // Refresh por fixture: deleta as do fixture e re-insere.
  const fixtureIds = Array.from(new Set(rows.map((r) => r.fixture_id)));
  await supabase
    .from("football_player_action_probabilities")
    .delete()
    .in("fixture_id", fixtureIds);

  const { error } = await supabase
    .from("football_player_action_probabilities")
    .insert(rows);
  if (error) {
    throw new Error(`upsertPlayerActionProbabilities: ${error.message}`);
  }
  return rows.length;
}
