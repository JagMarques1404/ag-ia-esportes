import "@/lib/server-only-guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Readiness gate — avalia se um fixture tem base estatística suficiente
 * para publicar uma pick oficial. Lê o estado do banco SEM chamar API.
 *
 * Decisão (Fase E.0A.5):
 *   READY     — ≥ 8 jogadores com histórico (sample ≥ 1)
 *               E ≥ 3 jogadores ofensivos (position F ou M) com histórico
 *               E data_quality médio ≥ 0.45
 *   WATCHLIST — ≥ 3 jogadores com histórico (sem atingir critérios de READY)
 *   BLOCKED   — < 3 jogadores com histórico
 *
 * Usado por:
 *   - daily-suggestions: se BLOCKED, não gera safe/value/mega.
 *   - report-manual-lineup-readiness: mostra ao usuário o que falta buscar.
 */

const SYNTHETIC_API_PLAYER_ID_MIN = 800_000_000;

export type ReadinessLevel = "READY" | "WATCHLIST" | "BLOCKED";

export interface ReadinessReport {
  api_fixture_id: number;
  fixture_id: string;
  match_name: string;
  total_lineup_players: number;
  /** sample_size > 0 (api_player_id real). */
  with_history: number;
  /** matched/api real porém sample = 0. */
  matched_no_history: number;
  /** api_player_id sintético (>= 800M) — manual sem resolver. */
  synthetic: number;
  /** ofensivos (F+M) com histórico. */
  offensive_with_history: number;
  /** data_quality médio dos jogadores com histórico (0..1). */
  avg_data_quality: number;
  level: ReadinessLevel;
  /** Mensagem humana explicando a decisão. */
  reason: string;
  /** Lista de até 20 jogadores que precisam ser resolvidos/coletados. */
  missing_players: Array<{
    player_name: string;
    team_name: string | null;
    api_player_id: number | null;
    why: string;
  }>;
}

interface LineupPlayerRow {
  player_id: string | null;
  api_player_id: number | null;
  player_name: string | null;
  team_id: string | null;
  position: string | null;
  is_starting: boolean | null;
}

interface FixtureRow {
  id: string;
  api_fixture_id: number;
  home_team_id: string | null;
  away_team_id: string | null;
  home_team_name: string | null;
  away_team_name: string | null;
}

async function loadFixture(
  apiFixtureId: number
): Promise<FixtureRow | null> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("football_fixtures")
    .select(
      "id, api_fixture_id, home_team_id, away_team_id, home_team_name, away_team_name"
    )
    .eq("api_fixture_id", apiFixtureId)
    .maybeSingle();
  return (data as FixtureRow) ?? null;
}

/**
 * Conta jogos finalizados em football_player_match_stats para uma lista
 * de api_player_ids. Retorna mapa apiId → count.
 */
async function getHistorySamples(
  apiPlayerIds: number[]
): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  if (apiPlayerIds.length === 0) return counts;
  const real = apiPlayerIds.filter(
    (id) => id > 0 && id < SYNTHETIC_API_PLAYER_ID_MIN
  );
  if (real.length === 0) return counts;

  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("football_player_match_stats")
    .select(
      "api_player_id, football_fixtures!inner(status)"
    )
    .in("api_player_id", real)
    .in("football_fixtures.status", ["FT", "AET", "PEN"]);

  for (const row of (data ?? []) as Array<{ api_player_id: number | null }>) {
    if (row.api_player_id == null) continue;
    counts.set(row.api_player_id, (counts.get(row.api_player_id) ?? 0) + 1);
  }
  return counts;
}

function dataQualityFromSample(n: number): number {
  if (n <= 1) return 0.2;
  if (n <= 3) return 0.5;
  return 0.8;
}

export async function evaluateFixtureReadinessForPick(
  apiFixtureId: number
): Promise<ReadinessReport> {
  const supabase = getSupabaseAdmin();
  const fixture = await loadFixture(apiFixtureId);
  if (!fixture) {
    throw new Error(`Fixture ${apiFixtureId} não encontrada.`);
  }

  const { data: lineupRows } = await supabase
    .from("football_lineup_players")
    .select(
      "player_id, api_player_id, player_name, team_id, position, is_starting"
    )
    .eq("fixture_id", fixture.id);
  const players = (lineupRows ?? []) as LineupPlayerRow[];

  const teamNameById = new Map<string, string | null>();
  if (fixture.home_team_id) teamNameById.set(fixture.home_team_id, fixture.home_team_name);
  if (fixture.away_team_id) teamNameById.set(fixture.away_team_id, fixture.away_team_name);

  const apiIds = players
    .map((p) => p.api_player_id)
    .filter((id): id is number => id != null && id > 0);
  const samples = await getHistorySamples(apiIds);

  let withHistory = 0;
  let matchedNoHistory = 0;
  let synthetic = 0;
  let offensiveWithHistory = 0;
  const dqValues: number[] = [];
  const missing: ReadinessReport["missing_players"] = [];

  for (const p of players) {
    const apiId = p.api_player_id;
    const teamName = p.team_id ? teamNameById.get(p.team_id) ?? null : null;
    const pos = (p.position ?? "").toUpperCase().slice(0, 1);
    const isOffensive = pos === "F" || pos === "M";

    if (apiId == null || apiId <= 0) {
      synthetic++;
      missing.push({
        player_name: p.player_name ?? "?",
        team_name: teamName,
        api_player_id: null,
        why: "sem api_player_id (precisa de resolver ou seed)",
      });
      continue;
    }
    if (apiId >= SYNTHETIC_API_PLAYER_ID_MIN) {
      synthetic++;
      missing.push({
        player_name: p.player_name ?? "?",
        team_name: teamName,
        api_player_id: apiId,
        why: "id sintético — escalação manual sem resolver real",
      });
      continue;
    }

    const sample = samples.get(apiId) ?? 0;
    if (sample > 0) {
      withHistory++;
      if (isOffensive) offensiveWithHistory++;
      dqValues.push(dataQualityFromSample(sample));
    } else {
      matchedNoHistory++;
      missing.push({
        player_name: p.player_name ?? "?",
        team_name: teamName,
        api_player_id: apiId,
        why: "jogador real mas sem histórico — rode collect:player-last5",
      });
    }
  }

  const avgDq =
    dqValues.length > 0
      ? Number((dqValues.reduce((a, b) => a + b, 0) / dqValues.length).toFixed(3))
      : 0;

  let level: ReadinessLevel;
  let reason: string;

  if (
    withHistory >= 8 &&
    offensiveWithHistory >= 3 &&
    avgDq >= 0.45
  ) {
    level = "READY";
    reason = `Base estatística suficiente: ${withHistory} jogadores com histórico, ${offensiveWithHistory} ofensivos, dq médio ${avgDq.toFixed(2)}.`;
  } else if (withHistory >= 3) {
    level = "WATCHLIST";
    const faltas: string[] = [];
    if (withHistory < 8) faltas.push(`${withHistory}/8 jogadores com histórico`);
    if (offensiveWithHistory < 3) faltas.push(`${offensiveWithHistory}/3 ofensivos`);
    if (avgDq < 0.45) faltas.push(`dq médio ${avgDq.toFixed(2)} (precisa ≥ 0.45)`);
    reason = `Watchlist: ${withHistory} com histórico, mas faltam — ${faltas.join("; ")}.`;
  } else {
    level = "BLOCKED";
    reason = `Bloqueado: apenas ${withHistory} jogador(es) com histórico real (mínimo 3). Resolver ${synthetic} sintéticos e/ou coletar histórico dos ${matchedNoHistory} resolvidos sem stats.`;
  }

  return {
    api_fixture_id: apiFixtureId,
    fixture_id: fixture.id,
    match_name: `${fixture.home_team_name ?? "?"} × ${fixture.away_team_name ?? "?"}`,
    total_lineup_players: players.length,
    with_history: withHistory,
    matched_no_history: matchedNoHistory,
    synthetic,
    offensive_with_history: offensiveWithHistory,
    avg_data_quality: avgDq,
    level,
    reason,
    missing_players: missing.slice(0, 20),
  };
}
