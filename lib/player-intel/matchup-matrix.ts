import type { Archetype } from "./archetypes";
import type { PlayerAction } from "./actions";

/**
 * Matriz de boosts/penalidades por confronto direto (archetype × archetype).
 *
 * Convenção:
 *   - chave externa: arquétipo do JOGADOR analisado.
 *   - chave intermediária: arquétipo do OPONENTE direto (matchup zone).
 *   - valor: parcial em pontos percentuais (0.05 = +5pp na probabilidade).
 *
 * Heurística v0.1, conservadora e explicável.
 *
 * IMPORTANTE: Os valores individuais aqui são pequenos (≤ 0.05).
 * O caller é responsável por capar a soma total — ver `MAX_MATCHUP_BOOST`.
 *
 * Não-encontrados retornam 0 (matchup neutro).
 */

export const MAX_MATCHUP_BOOST = 0.08;

type MatchupBoosts = Partial<Record<PlayerAction, number>>;

const BOOSTS: Partial<Record<Archetype, Partial<Record<Archetype, MatchupBoosts>>>> = {
  // ---- Atacante / centroavante ----
  striker_finisher: {
    aggressive_defender: { shot: 0.03, shot_on: 0.02, foul_drawn: 0.05 },
    foul_committer: { shot: 0.02, shot_on: 0.02, foul_drawn: 0.05 },
    aerial_defender: { shot: -0.02, shot_on: -0.02 },
    shot_blocker: { shot: 0.01, shot_on: -0.02, block: 0.03 },
    defensive_fullback: { shot: 0.02, shot_on: 0.02 },
  },
  pressing_forward: {
    aggressive_defender: { foul_drawn: 0.04, foul_committed: 0.02 },
    playmaker: { tackle: 0.02, foul_committed: 0.02 },
    ball_carrier: { tackle: 0.02 },
  },

  // ---- Pontas / drible ----
  winger_dribbler: {
    defensive_fullback: { foul_drawn: 0.05, shot: 0.02, key_pass: 0.02 },
    overlapping_fullback: { foul_drawn: 0.05, shot: 0.02 },
    aggressive_defender: { foul_drawn: 0.05, yellow_card: 0.01 },
    foul_committer: { foul_drawn: 0.05, yellow_card: 0.01 },
  },
  winger_crosser: {
    defensive_fullback: { key_pass: 0.04, assist: 0.02 },
    overlapping_fullback: { key_pass: 0.03, assist: 0.02 },
  },

  // ---- Meias ----
  playmaker: {
    ball_winner: { foul_drawn: 0.04, key_pass: 0.03, tackle: 0.02 },
    aggressive_defender: { foul_drawn: 0.04, key_pass: 0.02 },
    pressing_forward: { foul_drawn: 0.03, tackle: 0.02 },
  },
  ball_carrier: {
    ball_winner: { foul_drawn: 0.05, tackle: 0.02 },
    aggressive_defender: { foul_drawn: 0.04, tackle: 0.02 },
    foul_committer: { foul_drawn: 0.05 },
  },
  ball_winner: {
    playmaker: { tackle: 0.04, foul_committed: 0.03 },
    ball_carrier: { tackle: 0.04, foul_committed: 0.03, yellow_card: 0.01 },
    winger_dribbler: { tackle: 0.03, foul_committed: 0.03, yellow_card: 0.01 },
  },

  // ---- Laterais ----
  defensive_fullback: {
    winger_dribbler: { tackle: 0.04, foul_committed: 0.03, yellow_card: 0.01 },
    winger_crosser: { tackle: 0.03, foul_committed: 0.02, block: 0.02 },
  },
  overlapping_fullback: {
    winger_dribbler: { foul_committed: 0.03, key_pass: 0.02 },
    winger_crosser: { key_pass: 0.02, assist: 0.01 },
  },

  // ---- Zagueiros ----
  aggressive_defender: {
    striker_finisher: { foul_committed: 0.04, yellow_card: 0.02, block: 0.03 },
    pressing_forward: { foul_committed: 0.03, yellow_card: 0.02 },
    winger_dribbler: { foul_committed: 0.03, yellow_card: 0.01 },
    ball_carrier: { foul_committed: 0.03, yellow_card: 0.01 },
  },
  foul_committer: {
    striker_finisher: { foul_committed: 0.04, yellow_card: 0.02 },
    winger_dribbler: { foul_committed: 0.04, yellow_card: 0.02 },
    pressing_forward: { foul_committed: 0.03, yellow_card: 0.01 },
  },
  aerial_defender: {
    striker_finisher: { block: 0.03, foul_committed: 0.02 },
    pressing_forward: { foul_committed: 0.02 },
  },
  shot_blocker: {
    striker_finisher: { block: 0.04, shot: -0.02 },
    pressing_forward: { block: 0.02 },
  },

  // ---- Foul drawer / committer especialistas ----
  foul_drawer: {
    aggressive_defender: { foul_drawn: 0.04 },
    foul_committer: { foul_drawn: 0.05 },
  },
};

/**
 * Retorna o vetor de boosts por ação para um confronto myArc × oppArc.
 *
 * Sem matchup definido (sample baixo, lineup parcial) → vetor vazio.
 * Boosts individuais ≤ 0.05; cabe ao caller aplicar `MAX_MATCHUP_BOOST`
 * sobre a soma quando agregar várias fontes.
 */
export function getMatchupBoosts(
  myArchetype: Archetype | null,
  oppArchetype: Archetype | null
): MatchupBoosts {
  if (!myArchetype || !oppArchetype) return {};
  const byMine = BOOSTS[myArchetype];
  if (!byMine) return {};
  return byMine[oppArchetype] ?? {};
}

/**
 * Aplica o cap conservador na soma. Garante |boost| ≤ MAX_MATCHUP_BOOST.
 * Usado pelo caller depois de combinar matriz + heurística antiga.
 */
export function capMatchupBoost(boost: number): number {
  if (!Number.isFinite(boost)) return 0;
  if (boost > MAX_MATCHUP_BOOST) return MAX_MATCHUP_BOOST;
  if (boost < -MAX_MATCHUP_BOOST) return -MAX_MATCHUP_BOOST;
  return boost;
}

/**
 * Retorna o boost específico para uma ação. Conveniente quando o caller
 * já tem o vetor cacheado em explanation_json.
 */
export function getActionBoost(
  myArchetype: Archetype | null,
  oppArchetype: Archetype | null,
  action: PlayerAction
): number {
  const v = getMatchupBoosts(myArchetype, oppArchetype)[action];
  return v ?? 0;
}
