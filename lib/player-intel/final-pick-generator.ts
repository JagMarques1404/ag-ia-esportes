import "@/lib/server-only-guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Gerador final de picks por fixture (Fase E.0A.9).
 *
 *   - generateSoloPick      : 1 leg sólida (probabilidade × dq × sample)
 *   - generateSafeMulti     : 2-3 legs conservadoras
 *   - generateValueMulti    : 3-5 legs com risco moderado
 *   - generateGameWatchlist : top 10 referência (sem virar pick)
 *
 * Todas funções leem `football_player_action_probabilities` do fixture.
 * NÃO chamam API. NÃO gravam — caller decide persistir.
 *
 * Critérios padrão (mais rígidos que `build-from-board` da E.0A.7):
 *
 *   Solo    : forte, sample ≥ 5, dq ≥ 0.75, prob ≥ 0.80
 *   Safe    : forte, sample ≥ 4, dq ≥ 0.70, prob ≥ 0.75
 *   Value   : forte/monitorar, sample ≥ 4, dq ≥ 0.65, prob ≥ 0.65
 *   Watch   : forte+monitorar, sem filtro de prob (referência)
 *
 * Diversificação: no máximo 1 ação por jogador em cada bloco.
 *
 * Mercados preferidos (peso ligeiramente maior na ordenação) — usados
 * para tie-break na ordenação:
 *   shot, shot_on, foul_drawn, foul_committed, tackle, key_pass
 */

export type PickRisk = "solo" | "safe" | "value" | "watchlist";

export interface PickLeg {
  player_name: string;
  api_player_id: number | null;
  team_id: string | null;
  action_key: string;
  market: string;          // ex.: "≥ 1 finalização (qualquer)"
  line: number;
  probability: number;
  sample_size: number;
  hit_rate: number | null;
  avg_value: number | null;
  data_quality_score: number;
  data_origin: string;
  recommendation: string;
  rationale: string | null;
}

export interface GeneratedPick {
  api_fixture_id: number;
  risk: PickRisk;
  legs: PickLeg[];
  combined_probability: number;
  confidence: number;
  data_quality_avg: number;
  worst_leg: string | null;
  rationale: string;
  warning: string | null;
}

interface ProbabilityRow {
  api_player_id: number | null;
  player_name: string;
  team_id: string | null;
  action_key: string;
  action_label: string | null;
  line: number;
  line_label: string | null;
  probability: number;
  sample_size: number | null;
  hit_rate: number | null;
  avg_value: number | null;
  data_quality_score: number;
  recommendation: string | null;
  data_origin: string | null;
  rationale: string | null;
}

const PREFERRED_MARKETS = new Set([
  "shot",
  "shot_on",
  "foul_drawn",
  "foul_committed",
  "tackle",
  "key_pass",
]);

// Pares de ações DO MESMO jogador que faz sentido combinar — não
// penaliza correlation. Tudo fora dessa lista (mesmo jogador) é
// penalizado pesadamente.
const ALLOWED_SAME_PLAYER_PAIRS = new Set<string>([
  pairKey("shot", "shot_on"),
  pairKey("key_pass", "foul_drawn"),
  pairKey("tackle", "foul_committed"),
  pairKey("tackle", "interception"),
]);

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function marketReliability(actionKey: string): number {
  return PREFERRED_MARKETS.has(actionKey) ? 1.0 : 0.85;
}

function lineupConfidence(source: string | null | undefined): number {
  if (!source) return 0.85;
  if (source === "api_confirmed" || source === "manual_confirmed") return 1.0;
  if (source === "api_predicted" || source === "manual_predicted") return 0.95;
  return 0.85;
}

function rowToLeg(r: ProbabilityRow): PickLeg {
  return {
    player_name: r.player_name,
    api_player_id: r.api_player_id,
    team_id: r.team_id,
    action_key: r.action_key,
    market: r.line_label ?? r.action_label ?? r.action_key,
    line: Number(r.line) || 0,
    probability: Number(r.probability) || 0,
    sample_size: Number(r.sample_size) || 0,
    hit_rate: r.hit_rate != null ? Number(r.hit_rate) : null,
    avg_value: r.avg_value != null ? Number(r.avg_value) : null,
    data_quality_score: Number(r.data_quality_score) || 0,
    data_origin: r.data_origin ?? "missing",
    recommendation: r.recommendation ?? "monitorar",
    rationale: r.rationale,
  };
}

function dedupeByPlayer(legs: PickLeg[]): PickLeg[] {
  const byPlayer = new Map<string, PickLeg>();
  for (const l of legs) {
    const cur = byPlayer.get(l.player_name);
    if (!cur) byPlayer.set(l.player_name, l);
    else if (score(l) > score(cur)) byPlayer.set(l.player_name, l);
  }
  return Array.from(byPlayer.values()).sort((a, b) => score(b) - score(a));
}

/**
 * Score ajustado (E.0A.11):
 *   probability
 *   × data_quality_score
 *   × min(1, sample_size / 5)
 *   × market_reliability_weight
 *   × lineup_confidence_weight
 */
function score(l: PickLeg, lineupSource: string | null = null): number {
  return (
    l.probability *
    l.data_quality_score *
    Math.min(1, l.sample_size / 5) *
    marketReliability(l.action_key) *
    lineupConfidence(lineupSource)
  );
}

/**
 * Seleciona até N legs evitando correlação tóxica:
 *  - máx 1 jogador com 2 ações (e só se pair estiver em ALLOWED_SAME_PLAYER_PAIRS)
 *  - demais jogadores: 1 leg cada
 *  - input já deve estar ordenado por score desc
 */
function pickWithCorrelationControl(
  sorted: PickLeg[],
  cap: number
): PickLeg[] {
  const out: PickLeg[] = [];
  const usedPlayers = new Map<string, PickLeg>(); // primeira ação de cada player
  let secondActionGranted = false;

  for (const leg of sorted) {
    if (out.length >= cap) break;
    const prev = usedPlayers.get(leg.player_name);
    if (!prev) {
      usedPlayers.set(leg.player_name, leg);
      out.push(leg);
      continue;
    }
    // Mesmo jogador já tem leg — só aceita 1 "doubling" por pick.
    if (secondActionGranted) continue;
    if (ALLOWED_SAME_PLAYER_PAIRS.has(pairKey(prev.action_key, leg.action_key))) {
      out.push(leg);
      secondActionGranted = true;
    }
  }
  return out;
}

function combinedProbability(legs: PickLeg[]): number {
  if (legs.length === 0) return 0;
  return Number(
    legs
      .map((l) => Math.max(0, Math.min(1, l.probability)))
      .reduce((a, b) => a * b, 1)
      .toFixed(4)
  );
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(4));
}

function worstLegLabel(legs: PickLeg[]): string | null {
  if (legs.length === 0) return null;
  let worst = legs[0];
  for (const l of legs) if (l.probability < worst.probability) worst = l;
  return `${worst.player_name} — ${worst.market} (${(worst.probability * 100).toFixed(0)}%)`;
}

function rationaleFor(legs: PickLeg[], risk: PickRisk): string {
  const head =
    risk === "solo"
      ? "Entrada solo: 1 leg com maior produto prob × dq × sample."
      : risk === "safe"
        ? `Segura: ${legs.length} legs com sample ≥ 4, dq ≥ 0.70, prob ≥ 0.75.`
        : risk === "value"
          ? `Valor: ${legs.length} legs com tolerância intermediária — variância maior.`
          : `Watchlist: top 10 referência. Não publicável como pick.`;
  const bullets = legs
    .slice(0, 5)
    .map(
      (l) =>
        `- ${l.player_name} ${l.market} · p=${(l.probability * 100).toFixed(0)}% sample=${l.sample_size} dq=${l.data_quality_score.toFixed(2)}`
    );
  return head + "\n" + bullets.join("\n");
}

// ============================================================
// Carregamento da base do fixture
// ============================================================

interface LoadedBoard {
  rows: ProbabilityRow[];
  legs_strong: PickLeg[];      // recommendation='forte', exclui contextual
  legs_monitor: PickLeg[];     // recommendation='monitorar'
}

async function loadBoard(apiFixtureId: number): Promise<LoadedBoard> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("football_player_action_probabilities")
    .select(
      "api_player_id, player_name, team_id, action_key, action_label, line, line_label, probability, sample_size, hit_rate, avg_value, data_quality_score, recommendation, data_origin, rationale"
    )
    .eq("api_fixture_id", apiFixtureId)
    .in("recommendation", ["forte", "monitorar"])
    .order("probability", { ascending: false });
  if (error) throw new Error(`loadBoard: ${error.message}`);
  const rows = (data ?? []) as ProbabilityRow[];
  const legs = rows
    .filter(
      (r) => r.data_origin !== "contextual" && r.data_origin !== "missing"
    )
    .map(rowToLeg);
  return {
    rows,
    legs_strong: legs.filter((l) => l.recommendation === "forte"),
    legs_monitor: legs.filter((l) => l.recommendation === "monitorar"),
  };
}

// ============================================================
// Generators
// ============================================================

export async function generateSoloPick(
  apiFixtureId: number
): Promise<GeneratedPick | null> {
  const board = await loadBoard(apiFixtureId);
  const eligible = board.legs_strong.filter(
    (l) =>
      l.sample_size >= 5 &&
      l.data_quality_score >= 0.75 &&
      l.probability >= 0.8
  );
  if (eligible.length === 0) return null;
  const top = dedupeByPlayer(eligible)[0];
  if (!top) return null;
  return {
    api_fixture_id: apiFixtureId,
    risk: "solo",
    legs: [top],
    combined_probability: combinedProbability([top]),
    confidence: top.data_quality_score,
    data_quality_avg: top.data_quality_score,
    worst_leg: worstLegLabel([top]),
    rationale: rationaleFor([top], "solo"),
    warning: null,
  };
}

export async function generateSafeMulti(
  apiFixtureId: number
): Promise<GeneratedPick | null> {
  const board = await loadBoard(apiFixtureId);
  // E.0A.11: preferir mercados simples, tolerar prob 0.70 mas dq>=0.65
  const eligible = board.legs_strong
    .filter(
      (l) =>
        l.sample_size >= 4 &&
        l.data_quality_score >= 0.65 &&
        l.probability >= 0.7
    )
    .sort((a, b) => score(b) - score(a));
  // Permite até 3 legs com controle de correlação (1 jogador 2 ações OK se permitido)
  const candidates = pickWithCorrelationControl(eligible, 3);
  if (candidates.length < 2) return null;
  return {
    api_fixture_id: apiFixtureId,
    risk: "safe",
    legs: candidates,
    combined_probability: combinedProbability(candidates),
    confidence: avg(candidates.map((l) => l.data_quality_score)),
    data_quality_avg: avg(candidates.map((l) => l.data_quality_score)),
    worst_leg: worstLegLabel(candidates),
    rationale: rationaleFor(candidates, "safe"),
    warning: null,
  };
}

export async function generateValueMulti(
  apiFixtureId: number
): Promise<GeneratedPick | null> {
  const board = await loadBoard(apiFixtureId);
  // E.0A.11: tolerar prob 0.60, sample 3, dq 0.55
  const pool = [...board.legs_strong, ...board.legs_monitor]
    .filter(
      (l) =>
        l.sample_size >= 3 &&
        l.data_quality_score >= 0.55 &&
        l.probability >= 0.6
    )
    .sort((a, b) => score(b) - score(a));
  const candidates = pickWithCorrelationControl(pool, 5);
  if (candidates.length < 3) return null;
  return {
    api_fixture_id: apiFixtureId,
    risk: "value",
    legs: candidates,
    combined_probability: combinedProbability(candidates),
    confidence: avg(candidates.map((l) => l.data_quality_score)),
    data_quality_avg: avg(candidates.map((l) => l.data_quality_score)),
    worst_leg: worstLegLabel(candidates),
    rationale: rationaleFor(candidates, "value"),
    warning:
      "Combinação multiplicativa derruba probabilidade total — uma falha → perde tudo. Correlação possível entre jogadores do mesmo time.",
  };
}

export async function generateGameWatchlist(
  apiFixtureId: number
): Promise<GeneratedPick | null> {
  const board = await loadBoard(apiFixtureId);
  const pool = [...board.legs_strong, ...board.legs_monitor];
  if (pool.length === 0) return null;
  const top = dedupeByPlayer(pool).slice(0, 10);
  return {
    api_fixture_id: apiFixtureId,
    risk: "watchlist",
    legs: top,
    combined_probability: combinedProbability(top),
    confidence: avg(top.map((l) => l.data_quality_score)),
    data_quality_avg: avg(top.map((l) => l.data_quality_score)),
    worst_leg: worstLegLabel(top),
    rationale: rationaleFor(top, "watchlist"),
    warning: "Apenas referência. Não publicar como pick.",
  };
}

// ============================================================
// Persistência (chamada pelo worker)
// ============================================================

export interface SavePickInput {
  pick: GeneratedPick;
  pick_date: string;
  match_name: string;
  league_name: string | null;
  kickoff_at: string | null;
  generation_stage: "precheck" | "final";
  readiness_snapshot: Record<string, unknown>;
  /** Default 'draft'. */
  status?: "draft" | "published";
}

/**
 * Idempotente por (api_fixture_id, pick_date, risk). Substitui pick
 * anterior do mesmo tipo que ainda esteja em draft/published.
 */
export async function saveGeneratedPick(input: SavePickInput): Promise<{
  pick_id: string | null;
  legs_inserted: number;
}> {
  const supabase = getSupabaseAdmin();
  const status = input.status ?? "draft";

  // Idempotência: apaga pick anterior do mesmo risco/dia/fixture que
  // ainda não foi liquidado.
  await supabase
    .from("public_picks")
    .delete()
    .eq("api_fixture_id", input.pick.api_fixture_id)
    .eq("pick_date", input.pick_date)
    .eq("risk_level", input.pick.risk)
    .in("status", ["draft", "published"]);

  const title = (() => {
    const labels: Record<PickRisk, string> = {
      solo: "Solo",
      safe: "Segura",
      value: "Valor",
      watchlist: "Watchlist",
    };
    return `${labels[input.pick.risk]} ${input.match_name} (${input.pick.legs.length} leg${input.pick.legs.length === 1 ? "" : "s"})`;
  })();

  const { data: row, error } = await supabase
    .from("public_picks")
    .insert({
      pick_date: input.pick_date,
      title,
      match_name: input.match_name,
      league_name: input.league_name,
      api_fixture_id: input.pick.api_fixture_id,
      kickoff_at: input.kickoff_at,
      risk_level: input.pick.risk,
      status,
      odd_target: null,
      confidence: Number(input.pick.confidence.toFixed(3)),
      rationale: input.pick.rationale,
      warning: input.pick.warning,
      markets: input.pick.legs.map((l) => ({
        player: l.player_name,
        market: l.market,
        line: l.line,
      })) as unknown as object,
      source: "board_auto",
      generation_stage: input.generation_stage,
      generated_at: new Date().toISOString(),
      readiness_snapshot: input.readiness_snapshot as unknown as object,
    })
    .select("id")
    .single();
  if (error || !row) {
    throw new Error(`saveGeneratedPick (${input.pick.risk}): ${error?.message}`);
  }
  const pickId = row.id as string;

  if (input.pick.risk === "watchlist") {
    // Watchlist é informativo — não cria public_pick_legs (evita poluir).
    return { pick_id: pickId, legs_inserted: 0 };
  }

  const legRows = input.pick.legs.map((l, i) => ({
    pick_id: pickId,
    position: i + 1,
    player_name: l.player_name,
    market: l.market,
    line: l.line,
    odd: null,
    result_status: "pending",
  }));
  const { error: lErr } = await supabase
    .from("public_pick_legs")
    .insert(legRows);
  if (lErr) {
    throw new Error(`saveGeneratedPick legs (${input.pick.risk}): ${lErr.message}`);
  }
  return { pick_id: pickId, legs_inserted: legRows.length };
}
