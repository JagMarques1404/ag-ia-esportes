import "@/lib/server-only-guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Gera sugestões de auto-pick (safe/value/mega/watchlist) para um fixture
 * a partir das probabilidades já calculadas em
 * `football_player_action_probabilities`.
 *
 * Importante:
 *   - NÃO inclui odd. O usuário verá a odd na casa de aposta.
 *   - NÃO chama API-Football. Apenas lê o que está no banco.
 *   - NÃO grava nada. Quem grava é o orquestrador (script daily:auto-picks).
 *
 * Pré-requisitos: `runFixturePlayerIntel(apiFixtureId)` deve ter rodado
 * antes para popular as probabilidades.
 */

export type RiskLevel = "safe" | "value" | "mega" | "watchlist";

export interface SuggestionLeg {
  player_name: string;
  team_name: string | null;
  action_key: string;
  line_label: string;
  line: number;
  probability: number;
  sample_size: number;
  hit_rate: number | null;
  last5_values: number[];
  matchup_score: number;
  data_origin: string;
  recommendation: string;
  rationale: string;
  data_quality_score: number;
  confidence_score: number;
}

export interface SuggestionBlock {
  risk_level: RiskLevel;
  legs: SuggestionLeg[];
  /** Probabilidade combinada (produto das individuais). */
  estimated_probability: number;
  /** Média das confidences das legs. */
  confidence_score: number;
  /** Média dos data_quality_score das legs. */
  data_quality_score: number;
  /** Player+action da leg de menor probabilidade — “pior elo”. */
  worst_leg: string | null;
  rationale: string;
  warning: string | null;
}

export interface FixtureSuggestions {
  api_fixture_id: number;
  match_name: string;
  league_name: string | null;
  safe: SuggestionBlock | null;
  value: SuggestionBlock | null;
  mega: SuggestionBlock | null;
  watchlist: SuggestionBlock | null;
  /** Quantas linhas elegíveis (sample > 0, recommendation != evitar). */
  eligible_count: number;
  /** Quantas linhas totais (incluindo evitar / sample 0). */
  total_count: number;
}

interface ProbRow {
  api_player_id: number | null;
  player_name: string;
  team_id: string | null;
  action_key: string;
  line: number;
  line_label: string | null;
  probability: number;
  fair_odd: number | null;
  confidence_score: number;
  data_quality_score: number;
  matchup_score: number | null;
  sample_size: number | null;
  hit_rate: number | null;
  last5_values: unknown;
  recommendation: string | null;
  data_origin: string | null;
  rationale: string | null;
}

function combinedProbability(probs: number[]): number {
  if (probs.length === 0) return 0;
  return Number(
    probs.reduce((acc, p) => acc * Math.max(0, Math.min(1, p)), 1).toFixed(4)
  );
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(4));
}

function toLeg(row: ProbRow, teamName: string | null): SuggestionLeg {
  const last5 = Array.isArray(row.last5_values)
    ? (row.last5_values as unknown[]).map((v) => Number(v) || 0)
    : [];
  return {
    player_name: row.player_name ?? "?",
    team_name: teamName,
    action_key: row.action_key,
    line_label: row.line_label ?? `≥ ${row.line + 0.5} ${row.action_key}`,
    line: Number(row.line) || 0,
    probability: Number(row.probability) || 0,
    sample_size: Number(row.sample_size) || 0,
    hit_rate: row.hit_rate != null ? Number(row.hit_rate) : null,
    last5_values: last5,
    matchup_score: Number(row.matchup_score) || 0,
    data_origin: row.data_origin ?? "missing",
    recommendation: row.recommendation ?? "monitorar",
    rationale: row.rationale ?? "",
    data_quality_score: Number(row.data_quality_score) || 0,
    confidence_score: Number(row.confidence_score) || 0,
  };
}

function worstLegLabel(legs: SuggestionLeg[]): string | null {
  if (legs.length === 0) return null;
  let worst = legs[0];
  for (const l of legs) {
    if (l.probability < worst.probability) worst = l;
  }
  return `${worst.player_name} — ${worst.action_key} (${(worst.probability * 100).toFixed(0)}%)`;
}

function pickSafe(eligible: SuggestionLeg[]): SuggestionBlock | null {
  // Safe: 2-3 legs, maior data_quality, evitar recommendation='evitar' e sample 0.
  const candidates = eligible
    .filter((l) => l.sample_size >= 2 && l.recommendation !== "evitar")
    .sort((a, b) => {
      const dq = b.data_quality_score - a.data_quality_score;
      if (dq !== 0) return dq;
      return b.probability - a.probability;
    });
  if (candidates.length < 2) return null;
  const legs = candidates.slice(0, Math.min(3, candidates.length));
  return buildBlock(
    "safe",
    legs,
    "Entradas de maior consistência: jogadores com histórico ≥ 2 jogos e probabilidade individual sólida.",
    null
  );
}

function pickValue(eligible: SuggestionLeg[]): SuggestionBlock | null {
  // Value: 3-5 legs, prioriza probability * data_quality, aceita sample >= 1.
  const candidates = eligible
    .filter((l) => l.sample_size >= 1 && l.recommendation !== "evitar")
    .sort((a, b) => {
      const score =
        b.probability * b.data_quality_score -
        a.probability * a.data_quality_score;
      return score;
    });
  if (candidates.length < 3) return null;
  const legs = candidates.slice(0, Math.min(5, candidates.length));
  return buildBlock(
    "value",
    legs,
    "Mix de probabilidade alta + dado intermediário. Variância maior que a Safe — usar stake reduzida.",
    "Combinação multiplicativa derruba probabilidade total — se uma falhar, perde tudo."
  );
}

function pickMega(eligible: SuggestionLeg[]): SuggestionBlock | null {
  // Mega: 5+ legs com alta variância. Aceita sample baixo mas exige
  // pelo menos 5 candidatos no pool — senão vira watchlist.
  const candidates = eligible
    .filter((l) => l.recommendation !== "evitar")
    .sort((a, b) => b.probability - a.probability);
  if (candidates.length < 5) return null;
  const legs = candidates.slice(0, Math.min(7, candidates.length));
  return buildBlock(
    "mega",
    legs,
    "Combinação agressiva. Probabilidade combinada baixa mas retorno teórico alto. Stake mínima ou apenas para acompanhar.",
    "Alta variância — não usar como entrada principal. Pensada para apostas pequenas de longo prazo."
  );
}

function pickWatchlist(allLegs: SuggestionLeg[]): SuggestionBlock | null {
  // Watchlist: top 5 do board, mesmo com sample baixo / recommendation evitar.
  // Existe para o usuário ver onde o motor está olhando.
  if (allLegs.length === 0) return null;
  const top = [...allLegs]
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 5);
  return buildBlock(
    "watchlist",
    top,
    "Linhas que o motor está observando mas SEM dado suficiente para virar pick oficial. Apenas referência.",
    "Não usar como entrada — dados insuficientes ou sample muito baixo."
  );
}

function buildBlock(
  risk: RiskLevel,
  legs: SuggestionLeg[],
  rationale: string,
  warning: string | null
): SuggestionBlock {
  return {
    risk_level: risk,
    legs,
    estimated_probability: combinedProbability(legs.map((l) => l.probability)),
    confidence_score: avg(legs.map((l) => l.confidence_score)),
    data_quality_score: avg(legs.map((l) => l.data_quality_score)),
    worst_leg: worstLegLabel(legs),
    rationale,
    warning,
  };
}

interface FixtureMeta {
  id: string;
  api_fixture_id: number;
  match_name: string;
  league_name: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  home_team_name: string | null;
  away_team_name: string | null;
}

async function loadFixtureMeta(
  apiFixtureId: number
): Promise<FixtureMeta | null> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("football_fixtures")
    .select(
      "id, api_fixture_id, home_team_name, away_team_name, home_team_id, away_team_id, league_name"
    )
    .eq("api_fixture_id", apiFixtureId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    api_fixture_id: data.api_fixture_id as number,
    match_name: `${data.home_team_name ?? "?"} × ${data.away_team_name ?? "?"}`,
    league_name: (data.league_name as string | null) ?? null,
    home_team_id: (data.home_team_id as string | null) ?? null,
    away_team_id: (data.away_team_id as string | null) ?? null,
    home_team_name: (data.home_team_name as string | null) ?? null,
    away_team_name: (data.away_team_name as string | null) ?? null,
  };
}

export async function generateFixtureSuggestions(
  apiFixtureId: number
): Promise<FixtureSuggestions> {
  const supabase = getSupabaseAdmin();
  const meta = await loadFixtureMeta(apiFixtureId);
  if (!meta) {
    throw new Error(
      `Fixture ${apiFixtureId} não encontrado em football_fixtures.`
    );
  }

  const { data, error } = await supabase
    .from("football_player_action_probabilities")
    .select(
      "api_player_id, player_name, team_id, action_key, line, line_label, probability, fair_odd, confidence_score, data_quality_score, matchup_score, sample_size, hit_rate, last5_values, recommendation, data_origin, rationale"
    )
    .eq("api_fixture_id", apiFixtureId)
    .order("probability", { ascending: false });
  if (error) {
    throw new Error(`generateFixtureSuggestions: ${error.message}`);
  }
  const rows = (data ?? []) as ProbRow[];

  const teamNameById = new Map<string, string>();
  if (meta.home_team_id && meta.home_team_name)
    teamNameById.set(meta.home_team_id, meta.home_team_name);
  if (meta.away_team_id && meta.away_team_name)
    teamNameById.set(meta.away_team_id, meta.away_team_name);

  const allLegs = rows.map((r) =>
    toLeg(r, r.team_id ? teamNameById.get(r.team_id) ?? null : null)
  );

  // Dedupe por (player + action) — mantém a linha de maior probability.
  const byKey = new Map<string, SuggestionLeg>();
  for (const l of allLegs) {
    const key = `${l.player_name}|${l.action_key}`;
    const existing = byKey.get(key);
    if (!existing || l.probability > existing.probability) {
      byKey.set(key, l);
    }
  }
  const deduped = Array.from(byKey.values()).sort(
    (a, b) => b.probability - a.probability
  );

  const eligible = deduped.filter(
    (l) => l.sample_size > 0 && l.recommendation !== "evitar"
  );

  const safe = pickSafe(eligible);
  const value = pickValue(eligible);
  const mega = pickMega(eligible);
  // Watchlist sempre que nenhum dos 3 blocos saiu OU pelo menos para
  // referência ao usuário.
  const watchlist =
    safe == null && value == null && mega == null
      ? pickWatchlist(deduped)
      : null;

  return {
    api_fixture_id: apiFixtureId,
    match_name: meta.match_name,
    league_name: meta.league_name,
    safe,
    value,
    mega,
    watchlist,
    eligible_count: eligible.length,
    total_count: deduped.length,
  };
}
