import "@/lib/server-only-guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  clamp,
  poissonAtLeast,
  probabilityToFairOdd,
  roundDecimal,
} from "@/lib/features/math";
import type { Archetype } from "./archetypes";
import type { PlayerRecentForm } from "./recent-form";
import type { DirectMatchup } from "./matchups";

export const PLAYER_ACTIONS = [
  "shot",
  "shot_on",
  "foul_committed",
  "foul_drawn",
  "tackle",
  "card",
  "key_pass",
  // Sem dados ainda no schema 003 — gerar com data_quality=0.
  "cross",
  "aerial_duel",
  "block",
  "offside",
] as const;
export type PlayerAction = (typeof PLAYER_ACTIONS)[number];

export const ACTION_LABELS: Record<PlayerAction, string> = {
  shot: "Finalização (qualquer)",
  shot_on: "Finalização no gol",
  foul_committed: "Falta cometida",
  foul_drawn: "Falta sofrida",
  tackle: "Desarme",
  card: "Cartão (amarelo+vermelho)",
  key_pass: "Passe chave",
  cross: "Cruzamento",
  aerial_duel: "Duelo aéreo",
  block: "Bloqueio",
  offside: "Impedimento",
};

export const MODEL_VERSION = "player-intel-v0.1" as const;

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
}

// ============================================================
// Helpers
// ============================================================

function dataQualityFromSample(n: number): number {
  if (n <= 1) return 0.2;
  if (n <= 3) return 0.5;
  return 0.8;
}

/** Base λ por ação a partir das médias por jogo do recent_form. */
function baseLambda(form: PlayerRecentForm, action: PlayerAction): number {
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
    case "card":
      return form.cards_avg;
    case "key_pass":
      return form.key_passes_avg;
    case "cross":
      return form.crosses_avg;
    case "aerial_duel":
    case "block":
    case "offside":
      return 0; // sem dado granular ainda
  }
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
    (action === "foul_committed" || action === "card") &&
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
}

export function calculatePlayerActionProbability(
  input: CalculateInput,
  action: PlayerAction,
  line = 0.5
): PlayerActionProbability {
  const { player, form, matchup } = input;
  const dq = dataQualityFromSample(form.sample_size);

  const baseLam = baseLambda(form, action);
  const mAdj = matchupAdjustment(
    action,
    matchup?.player_archetype ?? null,
    matchup?.opponent_archetype ?? null
  );
  const minAdj = minutesAdjustment(player.is_starting);

  // λ ajustado por minutagem; matchup entra como delta na prob final.
  const adjustedLambda = baseLam * minAdj.factor;
  // Threshold k = ceil(line + 0.5) → prob de pelo menos k.
  const k = Math.max(1, Math.ceil(line + 0.5));
  const baseProb = poissonAtLeast(adjustedLambda, k);
  const finalProb = clamp(baseProb + mAdj.delta, 0.01, 0.99);

  // Confidence = data_quality × (1 - |delta_matchup|*2)
  const confidence = roundDecimal(
    clamp(dq * (1 - Math.min(0.5, Math.abs(mAdj.delta) * 2)), 0, 1),
    4
  );

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
      sample_size: form.sample_size,
      limitations: [
        ...(form.sample_size < 4
          ? [`sample_size=${form.sample_size} < 4 — confiança limitada`]
          : []),
        ...(["cross", "aerial_duel", "block", "offside"].includes(action)
          ? ["dado granular ausente no schema 003 — placeholder"]
          : []),
      ],
    },
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
