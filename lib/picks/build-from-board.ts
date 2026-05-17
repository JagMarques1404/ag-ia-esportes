import "@/lib/server-only-guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Helper compartilhado para construir picks (safe + value) a partir do
 * `football_player_action_probabilities` de um fixture. Usado por:
 *   - scripts/publish-board-picks.ts (one-shot)
 *   - scripts/daily-auto-full-pipeline.ts (orquestrador)
 *
 * Nunca chama API. Sempre respeita o readiness gate — caller é quem
 * decide chamar (este módulo apenas constrói/persiste).
 */

export interface BuildPicksInput {
  api_fixture_id: number;
  pick_date: string;
  league_name: string | null;
  match_name: string;
  kickoff_at: string | null;
  /** 'draft' = não aparece na vitrine; 'published' = visível. */
  status: "draft" | "published";
  /** Filtros do board. Defaults conservadores. */
  min_sample?: number;
  min_data_quality?: number;
}

export interface BuildPicksResult {
  api_fixture_id: number;
  safe_legs: BoardLeg[];
  value_legs: BoardLeg[];
  watchlist_legs: BoardLeg[];
  safe_pick_id: string | null;
  value_pick_id: string | null;
  /** Total de legs criadas em public_pick_legs (somente em real). */
  legs_inserted: number;
  /** Notas/avisos para o caller exibir. */
  notes: string[];
}

export interface BoardLeg {
  player_name: string;
  market: string;
  line: number;
  probability: number;
  sample_size: number;
  hit_rate: number | null;
  data_quality_score: number;
  rationale: string | null;
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
  data_quality_score: number;
  recommendation: string | null;
  data_origin: string | null;
  rationale: string | null;
}

// ============================================================
// Seleção de legs
// ============================================================

function dedupeByPlayer(legs: BoardLeg[]): BoardLeg[] {
  const byPlayer = new Map<string, BoardLeg>();
  for (const l of legs) {
    const cur = byPlayer.get(l.player_name);
    if (!cur || l.probability > cur.probability) byPlayer.set(l.player_name, l);
  }
  return Array.from(byPlayer.values()).sort(
    (a, b) => b.probability - a.probability
  );
}

function pickSafe(eligible: BoardLeg[]): BoardLeg[] {
  const candidates = dedupeByPlayer(
    eligible.filter((l) => l.probability >= 0.55)
  ).sort(
    (a, b) =>
      b.probability * b.data_quality_score -
      a.probability * a.data_quality_score
  );
  return candidates.slice(0, 3);
}

function pickValue(eligible: BoardLeg[]): BoardLeg[] {
  // Pega top por probability mas exclui os 3 que entraram em safe para
  // diversificar — o caller chama pickSafe antes para saber quais excluir.
  const candidates = dedupeByPlayer(
    eligible.filter((l) => l.probability >= 0.5)
  );
  return candidates.slice(0, 4);
}

function pickWatchlist(eligible: BoardLeg[]): BoardLeg[] {
  return dedupeByPlayer(eligible).slice(0, 10);
}

function legsToMarkets(legs: BoardLeg[]) {
  return legs.map((l) => ({
    player: l.player_name,
    market: l.market,
    line: l.line,
  }));
}

function buildTitle(matchName: string, riskLabel: "Segura" | "Valor", n: number) {
  return `${riskLabel} ${matchName} (${n} pernas)`;
}

function buildRationale(legs: BoardLeg[]): string {
  const lines = legs
    .slice(0, 3)
    .map(
      (l, i) =>
        `${i + 1}. ${l.player_name} — ${l.market} · prob ${(l.probability * 100).toFixed(0)}% · sample ${l.sample_size} · dq ${l.data_quality_score.toFixed(2)}`
    );
  return `Selecionado pelo board: legs de maior prob × dq.\n${lines.join("\n")}`;
}

// ============================================================
// Entrypoint
// ============================================================

/**
 * Lê probs do board, monta safe/value/watchlist, GRAVA em public_picks +
 * public_pick_legs (idempotente — apaga picks anteriores do mesmo
 * fixture+date que ainda não foram liquidadas).
 *
 * Para "dry run", o caller deve passar `dry=true` no campo extras — não,
 * desenho atual: este helper sempre grava. Para dry, o caller calcula
 * sem chamar este helper.
 *
 * Retorna lista de legs (mesmo em modo "dry-equivalente" via
 * `buildPicksPreview`).
 */
export async function buildPicksFromBoard(
  input: BuildPicksInput
): Promise<BuildPicksResult> {
  const preview = await buildPicksPreview(input);
  const supabase = getSupabaseAdmin();
  const notes: string[] = [...preview.notes];

  // Idempotência: apaga picks anteriores do board para este fixture+date
  // que ainda estão em draft/published (preserva green/red/void).
  await supabase
    .from("public_picks")
    .delete()
    .eq("api_fixture_id", input.api_fixture_id)
    .eq("pick_date", input.pick_date)
    .in("status", ["draft", "published"])
    .or(`title.like.Segura %,title.like.Valor %`);

  let safePickId: string | null = null;
  let valuePickId: string | null = null;
  let legsInserted = 0;

  if (preview.safe_legs.length >= 2) {
    const { data: pickRow, error: pErr } = await supabase
      .from("public_picks")
      .insert({
        pick_date: input.pick_date,
        title: buildTitle(input.match_name, "Segura", preview.safe_legs.length),
        match_name: input.match_name,
        league_name: input.league_name,
        api_fixture_id: input.api_fixture_id,
        kickoff_at: input.kickoff_at,
        risk_level: "safe",
        status: input.status,
        odd_target: null,
        confidence: Number(
          (
            preview.safe_legs.reduce((a, b) => a + b.data_quality_score, 0) /
            Math.max(1, preview.safe_legs.length)
          ).toFixed(3)
        ),
        rationale: buildRationale(preview.safe_legs),
        warning: null,
        markets: legsToMarkets(preview.safe_legs) as unknown as object,
      })
      .select("id")
      .single();
    if (pErr || !pickRow) {
      notes.push(`safe insert falhou: ${pErr?.message}`);
    } else {
      safePickId = pickRow.id as string;
      const legRows = preview.safe_legs.map((l, i) => ({
        pick_id: safePickId!,
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
      if (lErr) notes.push(`safe legs insert falhou: ${lErr.message}`);
      else legsInserted += legRows.length;
    }
  }

  if (preview.value_legs.length >= 3) {
    const { data: pickRow, error: pErr } = await supabase
      .from("public_picks")
      .insert({
        pick_date: input.pick_date,
        title: buildTitle(input.match_name, "Valor", preview.value_legs.length),
        match_name: input.match_name,
        league_name: input.league_name,
        api_fixture_id: input.api_fixture_id,
        kickoff_at: input.kickoff_at,
        risk_level: "value",
        status: input.status,
        odd_target: null,
        confidence: Number(
          (
            preview.value_legs.reduce((a, b) => a + b.data_quality_score, 0) /
            Math.max(1, preview.value_legs.length)
          ).toFixed(3)
        ),
        rationale: buildRationale(preview.value_legs),
        warning:
          "Combinação multiplicativa derruba probabilidade total — uma falha → perde tudo.",
        markets: legsToMarkets(preview.value_legs) as unknown as object,
      })
      .select("id")
      .single();
    if (pErr || !pickRow) {
      notes.push(`value insert falhou: ${pErr?.message}`);
    } else {
      valuePickId = pickRow.id as string;
      const legRows = preview.value_legs.map((l, i) => ({
        pick_id: valuePickId!,
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
      if (lErr) notes.push(`value legs insert falhou: ${lErr.message}`);
      else legsInserted += legRows.length;
    }
  }

  return {
    ...preview,
    safe_pick_id: safePickId,
    value_pick_id: valuePickId,
    legs_inserted: legsInserted,
    notes,
  };
}

/**
 * Mesma seleção de legs, mas SEM gravar. Usado em dryRun.
 */
export async function buildPicksPreview(
  input: BuildPicksInput
): Promise<BuildPicksResult> {
  const supabase = getSupabaseAdmin();
  const minSample = input.min_sample ?? 4;
  const minDq = input.min_data_quality ?? 0.7;

  const { data: probs, error } = await supabase
    .from("football_player_action_probabilities")
    .select(
      "api_player_id, player_name, team_id, action_key, action_label, line, line_label, probability, sample_size, hit_rate, data_quality_score, recommendation, data_origin, rationale"
    )
    .eq("api_fixture_id", input.api_fixture_id)
    .eq("recommendation", "forte")
    .gte("sample_size", minSample)
    .gte("data_quality_score", minDq)
    .order("probability", { ascending: false });

  const notes: string[] = [];
  if (error) {
    notes.push(`probs query: ${error.message}`);
    return {
      api_fixture_id: input.api_fixture_id,
      safe_legs: [],
      value_legs: [],
      watchlist_legs: [],
      safe_pick_id: null,
      value_pick_id: null,
      legs_inserted: 0,
      notes,
    };
  }

  const rows = (probs ?? []) as ProbabilityRow[];
  const eligible: BoardLeg[] = rows
    .filter(
      (r) => r.data_origin !== "contextual" && r.data_origin !== "missing"
    )
    .map((r) => ({
      player_name: r.player_name,
      market: r.line_label ?? r.action_label ?? r.action_key,
      line: Number(r.line) || 0,
      probability: Number(r.probability) || 0,
      sample_size: Number(r.sample_size) || 0,
      hit_rate: r.hit_rate != null ? Number(r.hit_rate) : null,
      data_quality_score: Number(r.data_quality_score) || 0,
      rationale: r.rationale,
    }));

  const safeLegs = pickSafe(eligible);
  const valueLegs = pickValue(eligible);
  const watchlistLegs = pickWatchlist(eligible);

  return {
    api_fixture_id: input.api_fixture_id,
    safe_legs: safeLegs,
    value_legs: valueLegs,
    watchlist_legs: watchlistLegs,
    safe_pick_id: null,
    value_pick_id: null,
    legs_inserted: 0,
    notes,
  };
}
