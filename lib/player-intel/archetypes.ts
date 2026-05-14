// Arquétipos de jogador. A classificação é heurística baseada em
// posição (G/D/M/F vinda do API-Football) + médias por ação dos
// últimos jogos. Sem stats suficientes, classifyPlayerArchetype
// retorna null e o caller trata como sinal frágil.

export const ARCHETYPES = [
  "goalkeeper",
  "striker_finisher",
  "winger_dribbler",
  "winger_crosser",
  "playmaker",
  "ball_carrier",
  "ball_winner",
  "aggressive_defender",
  "aerial_defender",
  "overlapping_fullback",
  "defensive_fullback",
  "pressing_forward",
  "foul_drawer",
  "foul_committer",
  "shot_blocker",
] as const;

export type Archetype = (typeof ARCHETYPES)[number];

/**
 * Posição vinda do API-Football: G (goalkeeper), D (defender),
 * M (midfielder), F (forward). Em /fixtures/players o campo é
 * `games.position`. Em /fixtures/lineups vem em `player.pos`.
 */
export type ApiPosition = "G" | "D" | "M" | "F" | string | null | undefined;

export interface ClassifierInput {
  position?: ApiPosition;
  sample_size: number;
  shots_avg: number;
  shots_on_avg: number;
  fouls_committed_avg: number;
  fouls_drawn_avg: number;
  tackles_avg: number;
  interceptions_avg: number;
  cards_avg: number;
  key_passes_avg: number;
  crosses_avg: number;
  duels_won_avg: number;
  duels_lost_avg: number;
}

export interface ClassifierOutput {
  archetype: Archetype | null;
  secondary: Archetype[];
  reasons: string[];
}

function bucketizePosition(pos: ApiPosition): "G" | "D" | "M" | "F" | "?" {
  if (!pos) return "?";
  const p = pos.toString().toUpperCase().slice(0, 1);
  if (p === "G" || p === "D" || p === "M" || p === "F") return p;
  return "?";
}

/**
 * Heurística simples e explicável. Sem stats (sample < 2), só usa
 * a posição como pista bruta. Com stats, prioriza arquétipo dominante
 * por ação relativa.
 */
export function classifyPlayerArchetype(
  input: ClassifierInput
): ClassifierOutput {
  const reasons: string[] = [];
  const secondary: Archetype[] = [];
  const pos = bucketizePosition(input.position);

  // Sample muito baixo: só posição como proxy frágil.
  if (input.sample_size < 2) {
    reasons.push(`sample_size=${input.sample_size} < 2 — só posição`);
    if (pos === "G") return { archetype: "goalkeeper", secondary, reasons };
    if (pos === "F")
      return { archetype: "striker_finisher", secondary, reasons };
    if (pos === "D")
      return { archetype: "defensive_fullback", secondary, reasons };
    if (pos === "M") return { archetype: "playmaker", secondary, reasons };
    return { archetype: null, secondary, reasons };
  }

  // Goleiro é caso degenerado.
  if (pos === "G") {
    reasons.push("posição G");
    return { archetype: "goalkeeper", secondary, reasons };
  }

  // Sinais por ação. Thresholds calibrados em escala "por jogo".
  const isFinisher = input.shots_on_avg >= 1.0 && pos === "F";
  const isDribblerWinger =
    input.fouls_drawn_avg >= 1.5 &&
    input.duels_won_avg >= 1.0 &&
    (pos === "F" || pos === "M");
  const isCrosserWinger =
    input.crosses_avg >= 1.5 && (pos === "M" || pos === "D");
  const isPlaymaker = input.key_passes_avg >= 1.5;
  const isBallCarrier =
    input.duels_won_avg >= 2.0 && input.fouls_drawn_avg >= 1.0;
  const isBallWinner =
    input.tackles_avg + input.interceptions_avg >= 3.0 && pos === "M";
  const isAggressiveDefender =
    input.tackles_avg >= 2.0 && input.cards_avg >= 0.3;
  const isAerialDefender = input.duels_won_avg >= 2.5 && pos === "D";
  const isOverlappingFB =
    pos === "D" && (input.crosses_avg >= 1.0 || input.key_passes_avg >= 0.7);
  const isDefensiveFB =
    pos === "D" && input.tackles_avg >= 1.5 && input.crosses_avg < 1.0;
  const isPressingFW =
    pos === "F" && input.tackles_avg + input.fouls_committed_avg >= 1.5;
  const isFoulDrawer = input.fouls_drawn_avg >= 2.0;
  const isFoulCommitter =
    input.fouls_committed_avg >= 1.5 || input.cards_avg >= 0.4;
  const isShotBlocker =
    pos === "D" && input.interceptions_avg + input.tackles_avg >= 3.0;

  // Escolhe o arquétipo dominante. Se mais de um sinal acende,
  // o primeiro vai como primário e os outros vão para secondary.
  const candidates: { arc: Archetype; reason: string }[] = [];
  if (isFinisher) candidates.push({ arc: "striker_finisher", reason: "shots_on ≥ 1.0 + F" });
  if (isDribblerWinger) candidates.push({ arc: "winger_dribbler", reason: "fouls_drawn ≥ 1.5 + duels_won ≥ 1" });
  if (isCrosserWinger) candidates.push({ arc: "winger_crosser", reason: "crosses ≥ 1.5" });
  if (isPlaymaker) candidates.push({ arc: "playmaker", reason: "key_passes ≥ 1.5" });
  if (isBallCarrier) candidates.push({ arc: "ball_carrier", reason: "duels_won ≥ 2 + fouls_drawn ≥ 1" });
  if (isBallWinner) candidates.push({ arc: "ball_winner", reason: "tackles+interceptions ≥ 3 + M" });
  if (isAggressiveDefender) candidates.push({ arc: "aggressive_defender", reason: "tackles ≥ 2 + cards ≥ 0.3" });
  if (isAerialDefender) candidates.push({ arc: "aerial_defender", reason: "duels_won ≥ 2.5 + D" });
  if (isOverlappingFB) candidates.push({ arc: "overlapping_fullback", reason: "D + crosses/key_passes ofensivos" });
  if (isDefensiveFB) candidates.push({ arc: "defensive_fullback", reason: "D + tackles ≥ 1.5 + sem crosses" });
  if (isPressingFW) candidates.push({ arc: "pressing_forward", reason: "F + tackles+fouls ≥ 1.5" });
  if (isFoulDrawer) candidates.push({ arc: "foul_drawer", reason: "fouls_drawn ≥ 2" });
  if (isFoulCommitter) candidates.push({ arc: "foul_committer", reason: "fouls_committed ≥ 1.5 ou cards ≥ 0.4" });
  if (isShotBlocker) candidates.push({ arc: "shot_blocker", reason: "D + tackles+interceptions ≥ 3" });

  if (candidates.length === 0) {
    reasons.push("nenhum sinal forte — fallback por posição");
    if (pos === "F") return { archetype: "striker_finisher", secondary, reasons };
    if (pos === "M") return { archetype: "playmaker", secondary, reasons };
    if (pos === "D") return { archetype: "defensive_fullback", secondary, reasons };
    return { archetype: null, secondary, reasons };
  }

  reasons.push(...candidates.map((c) => `${c.arc}: ${c.reason}`));
  const [primary, ...rest] = candidates;
  return {
    archetype: primary.arc,
    secondary: rest.map((c) => c.arc).slice(0, 3),
    reasons,
  };
}
