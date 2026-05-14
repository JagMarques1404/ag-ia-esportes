import "@/lib/server-only-guard";
import { apiFootballGet } from "./client";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  normalizeLeagueFromFixture,
  type NormalizedLeagueRow,
} from "./normalizers/leagues";
import {
  normalizeTeamFromFixture,
  type NormalizedTeamRow,
} from "./normalizers/teams";
import {
  normalizeFixture,
  type RawApiFixtureBlock,
} from "./normalizers/fixtures";
import {
  normalizeLineup,
  normalizeLineupPlayers,
  type RawApiLineup,
} from "./normalizers/lineups";
import {
  normalizeTeamStats,
  type RawApiTeamStatBlock,
} from "./normalizers/stats";

const PROVIDER = "api-football";

interface ApiFootballEnvelope<T> {
  get: string;
  parameters: Record<string, string>;
  errors: unknown;
  results: number;
  paging: { current: number; total: number };
  response: T;
}

// ============================================================
// Sync runs (auditoria)
// ============================================================

async function startSyncRun(
  syncType: string,
  metadata: Record<string, unknown> = {}
): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("football_sync_runs")
    .insert({
      provider: PROVIDER,
      sync_type: syncType,
      status: "running",
      metadata_json: metadata,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Erro ao criar sync run: ${error.message}`);
  return data.id as string;
}

async function finishSyncRun(
  id: string,
  patch: {
    status: "success" | "error";
    records_created?: number;
    records_updated?: number;
    error_message?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const supabase = getSupabaseAdmin();
  await supabase
    .from("football_sync_runs")
    .update({
      status: patch.status,
      finished_at: new Date().toISOString(),
      records_created: patch.records_created ?? 0,
      records_updated: patch.records_updated ?? 0,
      error_message: patch.error_message ?? null,
      metadata_json: patch.metadata ?? {},
    })
    .eq("id", id);
}

// ============================================================
// Fixtures por data (entrypoint principal)
// ============================================================

export interface SyncFixturesByDateResult {
  syncRunId: string;
  date: string;
  total_fixtures: number;
  total_leagues: number;
  total_teams: number;
}

export async function syncFixturesByDate(
  date: string
): Promise<SyncFixturesByDateResult> {
  const supabase = getSupabaseAdmin();
  const syncRunId = await startSyncRun("fixtures-by-date", { date });

  try {
    const body = await apiFootballGet<ApiFootballEnvelope<RawApiFixtureBlock[]>>(
      "/fixtures",
      { date },
      { essential: true }
    );

    const fixtures = body.response ?? [];

    // Coletar ligas e times únicos
    const leaguesMap = new Map<number, NormalizedLeagueRow>();
    const teamsMap = new Map<number, NormalizedTeamRow>();

    for (const block of fixtures) {
      if (!leaguesMap.has(block.league.id)) {
        leaguesMap.set(block.league.id, normalizeLeagueFromFixture(block.league));
      }
      if (!teamsMap.has(block.teams.home.id)) {
        teamsMap.set(
          block.teams.home.id,
          normalizeTeamFromFixture(block.teams.home)
        );
      }
      if (!teamsMap.has(block.teams.away.id)) {
        teamsMap.set(
          block.teams.away.id,
          normalizeTeamFromFixture(block.teams.away)
        );
      }
    }

    if (leaguesMap.size > 0) {
      const { error } = await supabase
        .from("football_leagues")
        .upsert(Array.from(leaguesMap.values()), {
          onConflict: "api_league_id",
        });
      if (error) throw new Error(`Erro ao salvar leagues: ${error.message}`);
    }

    if (teamsMap.size > 0) {
      const { error } = await supabase
        .from("football_teams")
        .upsert(Array.from(teamsMap.values()), { onConflict: "api_team_id" });
      if (error) throw new Error(`Erro ao salvar teams: ${error.message}`);
    }

    // Resolver IDs internos
    const leagueIdsByApi = new Map<number, string>();
    const teamIdsByApi = new Map<number, string>();

    if (leaguesMap.size > 0) {
      const { data } = await supabase
        .from("football_leagues")
        .select("id, api_league_id")
        .in("api_league_id", Array.from(leaguesMap.keys()));
      for (const l of data ?? []) {
        if (l.api_league_id != null) leagueIdsByApi.set(l.api_league_id, l.id);
      }
    }
    if (teamsMap.size > 0) {
      const { data } = await supabase
        .from("football_teams")
        .select("id, api_team_id")
        .in("api_team_id", Array.from(teamsMap.keys()));
      for (const t of data ?? []) {
        if (t.api_team_id != null) teamIdsByApi.set(t.api_team_id, t.id);
      }
    }

    // Upsert fixtures
    const fixtureRows = fixtures.map((block) =>
      normalizeFixture(
        block,
        leagueIdsByApi.get(block.league.id) ?? null,
        teamIdsByApi.get(block.teams.home.id) ?? null,
        teamIdsByApi.get(block.teams.away.id) ?? null
      )
    );

    if (fixtureRows.length > 0) {
      const { error } = await supabase
        .from("football_fixtures")
        .upsert(fixtureRows, { onConflict: "api_fixture_id" });
      if (error) throw new Error(`Erro ao salvar fixtures: ${error.message}`);
    }

    const result: SyncFixturesByDateResult = {
      syncRunId,
      date,
      total_fixtures: fixtureRows.length,
      total_leagues: leaguesMap.size,
      total_teams: teamsMap.size,
    };

    await finishSyncRun(syncRunId, {
      status: "success",
      records_created: fixtureRows.length,
      records_updated: 0,
      metadata: {
        date,
        total_fixtures: result.total_fixtures,
        total_leagues: result.total_leagues,
        total_teams: result.total_teams,
      },
    });

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishSyncRun(syncRunId, {
      status: "error",
      error_message: message,
    });
    throw err;
  }
}

export async function syncTodayFixtures(): Promise<SyncFixturesByDateResult> {
  const today = new Date().toISOString().split("T")[0];
  return syncFixturesByDate(today);
}

// ============================================================
// Lineups
// ============================================================

export interface SyncFixtureLineupsResult {
  syncRunId: string;
  api_fixture_id: number;
  total_lineups: number;
  total_players: number;
}

export async function syncFixtureLineups(
  apiFixtureId: number
): Promise<SyncFixtureLineupsResult> {
  const supabase = getSupabaseAdmin();
  const syncRunId = await startSyncRun("fixture-lineups", {
    api_fixture_id: apiFixtureId,
  });

  try {
    const { data: fixtureRow, error: fxError } = await supabase
      .from("football_fixtures")
      .select(
        "id, home_team_id, away_team_id, api_home_team_id, api_away_team_id"
      )
      .eq("api_fixture_id", apiFixtureId)
      .maybeSingle();
    if (fxError)
      throw new Error(`Erro ao buscar fixture local: ${fxError.message}`);
    if (!fixtureRow)
      throw new Error(
        `Fixture local não encontrada para api_fixture_id=${apiFixtureId}. Rode antes /api/football/fixtures/today.`
      );

    const fixtureId: string = fixtureRow.id;
    const homeTeamId: string | null = fixtureRow.home_team_id;
    const awayTeamId: string | null = fixtureRow.away_team_id;
    const apiHomeTeamId: number | null = fixtureRow.api_home_team_id;
    const apiAwayTeamId: number | null = fixtureRow.api_away_team_id;

    const body = await apiFootballGet<ApiFootballEnvelope<RawApiLineup[]>>(
      "/fixtures/lineups",
      { fixture: apiFixtureId }
    );
    const lineups = body.response ?? [];

    // Refresh: apaga lineups anteriores do fixture
    await supabase.from("football_lineups").delete().eq("fixture_id", fixtureId);

    function resolveTeamId(apiTeamId: number): string | null {
      if (apiTeamId === apiHomeTeamId) return homeTeamId;
      if (apiTeamId === apiAwayTeamId) return awayTeamId;
      return null;
    }

    const lineupRows = lineups.map((apiLineup) =>
      normalizeLineup(apiLineup, fixtureId, resolveTeamId(apiLineup.team.id))
    );

    let insertedLineups: { id: string; api_team_id: number | null }[] = [];
    if (lineupRows.length > 0) {
      const { data, error } = await supabase
        .from("football_lineups")
        .insert(lineupRows)
        .select("id, api_team_id");
      if (error) throw new Error(`Erro ao salvar lineups: ${error.message}`);
      insertedLineups = data ?? [];
    }

    let totalPlayers = 0;

    for (const apiLineup of lineups) {
      const lineupRow = insertedLineups.find(
        (l) => l.api_team_id === apiLineup.team.id
      );
      if (!lineupRow) continue;

      const teamId = resolveTeamId(apiLineup.team.id);
      const playerRows = normalizeLineupPlayers(apiLineup, fixtureId, teamId);
      if (playerRows.length === 0) continue;

      // Garantir player básico em football_players
      const playerBasics = playerRows.map((p) => ({
        api_player_id: p.api_player_id,
        name: p.player_name,
        current_team_id: teamId,
      }));
      const { error: pUpsertErr } = await supabase
        .from("football_players")
        .upsert(playerBasics, { onConflict: "api_player_id" });
      if (pUpsertErr)
        throw new Error(`Erro ao upsert players: ${pUpsertErr.message}`);

      // Resolver player_id local
      const apiIds = playerRows.map((p) => p.api_player_id);
      const { data: locals } = await supabase
        .from("football_players")
        .select("id, api_player_id")
        .in("api_player_id", apiIds);
      const playerIdByApi = new Map<number, string>();
      for (const lp of locals ?? []) {
        if (lp.api_player_id != null) playerIdByApi.set(lp.api_player_id, lp.id);
      }

      const fullRows = playerRows.map((p) => ({
        ...p,
        lineup_id: lineupRow.id,
        player_id: playerIdByApi.get(p.api_player_id) ?? null,
      }));

      const { error: insErr } = await supabase
        .from("football_lineup_players")
        .insert(fullRows);
      if (insErr)
        throw new Error(`Erro ao salvar lineup_players: ${insErr.message}`);
      totalPlayers += fullRows.length;
    }

    const result: SyncFixtureLineupsResult = {
      syncRunId,
      api_fixture_id: apiFixtureId,
      total_lineups: lineupRows.length,
      total_players: totalPlayers,
    };

    await finishSyncRun(syncRunId, {
      status: "success",
      records_created: lineupRows.length + totalPlayers,
      metadata: {
        api_fixture_id: apiFixtureId,
        total_lineups: result.total_lineups,
        total_players: result.total_players,
      },
    });

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishSyncRun(syncRunId, {
      status: "error",
      error_message: message,
    });
    throw err;
  }
}

// ============================================================
// Team stats
// ============================================================

export interface SyncFixtureTeamStatsResult {
  syncRunId: string;
  api_fixture_id: number;
  total_team_stats: number;
}

export async function syncFixtureTeamStats(
  apiFixtureId: number
): Promise<SyncFixtureTeamStatsResult> {
  const supabase = getSupabaseAdmin();
  const syncRunId = await startSyncRun("fixture-team-stats", {
    api_fixture_id: apiFixtureId,
  });

  try {
    const { data: fixtureRow, error: fxError } = await supabase
      .from("football_fixtures")
      .select(
        "id, home_team_id, away_team_id, api_home_team_id, api_away_team_id, status"
      )
      .eq("api_fixture_id", apiFixtureId)
      .maybeSingle();
    if (fxError)
      throw new Error(`Erro ao buscar fixture local: ${fxError.message}`);
    if (!fixtureRow)
      throw new Error(
        `Fixture local não encontrada para api_fixture_id=${apiFixtureId}.`
      );

    const fixtureId: string = fixtureRow.id;
    const homeTeamId: string | null = fixtureRow.home_team_id;
    const awayTeamId: string | null = fixtureRow.away_team_id;
    const apiHomeTeamId: number | null = fixtureRow.api_home_team_id;
    const apiAwayTeamId: number | null = fixtureRow.api_away_team_id;
    const fixtureStatus: string | null = fixtureRow.status;

    const body = await apiFootballGet<ApiFootballEnvelope<RawApiTeamStatBlock[]>>(
      "/fixtures/statistics",
      { fixture: apiFixtureId, status: fixtureStatus ?? undefined }
    );
    const blocks = body.response ?? [];

    await supabase
      .from("football_team_match_stats")
      .delete()
      .eq("fixture_id", fixtureId);

    function resolveTeamId(apiTeamId: number): {
      teamId: string | null;
      opponentTeamId: string | null;
    } {
      if (apiTeamId === apiHomeTeamId) {
        return { teamId: homeTeamId, opponentTeamId: awayTeamId };
      }
      if (apiTeamId === apiAwayTeamId) {
        return { teamId: awayTeamId, opponentTeamId: homeTeamId };
      }
      return { teamId: null, opponentTeamId: null };
    }

    const rows = blocks.map((block) => {
      const { teamId, opponentTeamId } = resolveTeamId(block.team.id);
      return normalizeTeamStats(block, fixtureId, teamId, opponentTeamId);
    });

    if (rows.length > 0) {
      const { error } = await supabase
        .from("football_team_match_stats")
        .insert(rows);
      if (error) throw new Error(`Erro ao salvar team stats: ${error.message}`);
    }

    const result: SyncFixtureTeamStatsResult = {
      syncRunId,
      api_fixture_id: apiFixtureId,
      total_team_stats: rows.length,
    };

    await finishSyncRun(syncRunId, {
      status: "success",
      records_created: rows.length,
      metadata: {
        api_fixture_id: apiFixtureId,
        total_team_stats: result.total_team_stats,
      },
    });

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishSyncRun(syncRunId, {
      status: "error",
      error_message: message,
    });
    throw err;
  }
}

// ============================================================
// Player stats individuais (Fase 4)
// ============================================================

interface RawApiFixturePlayersBlock {
  team: { id: number; name: string };
  players: Array<{
    player: { id: number; name: string; photo?: string };
    statistics: Array<{
      games?: {
        minutes?: number | null;
        number?: number | null;
        position?: string | null;
        rating?: string | null;
        captain?: boolean | null;
        substitute?: boolean | null;
      };
      offsides?: number | null;
      shots?: { total?: number | null; on?: number | null };
      goals?: {
        total?: number | null;
        conceded?: number | null;
        assists?: number | null;
        saves?: number | null;
      };
      passes?: {
        total?: number | null;
        key?: number | null;
        accuracy?: number | string | null;
      };
      tackles?: {
        total?: number | null;
        blocks?: number | null;
        interceptions?: number | null;
      };
      duels?: { total?: number | null; won?: number | null };
      dribbles?: {
        attempts?: number | null;
        success?: number | null;
        past?: number | null;
      };
      fouls?: { drawn?: number | null; committed?: number | null };
      cards?: { yellow?: number | null; red?: number | null };
    }>;
  }>;
}

export interface SyncFixturePlayerStatsResult {
  syncRunId: string;
  api_fixture_id: number;
  total_player_stats: number;
  duplicate_players_dropped: number;
  duplicate_stats_dropped: number;
}

/**
 * Dedupe genérico mantendo o item de maior score por chave.
 * Sem scoreFn, mantém o último item visto para a chave.
 * Retorna [únicos, descartados].
 */
function dedupeByKey<T>(
  items: readonly T[],
  keyFn: (item: T) => string,
  scoreFn?: (item: T) => number
): [T[], number] {
  const best = new Map<string, T>();
  let dropped = 0;
  for (const item of items) {
    const key = keyFn(item);
    const prev = best.get(key);
    if (prev === undefined) {
      best.set(key, item);
      continue;
    }
    dropped++;
    if (scoreFn) {
      best.set(key, scoreFn(item) > scoreFn(prev) ? item : prev);
    } else {
      best.set(key, item);
    }
  }
  return [Array.from(best.values()), dropped];
}

export async function syncFixturePlayerStats(
  apiFixtureId: number
): Promise<SyncFixturePlayerStatsResult> {
  const supabase = getSupabaseAdmin();
  const syncRunId = await startSyncRun("fixture-player-stats", {
    api_fixture_id: apiFixtureId,
  });

  try {
    const { data: fixtureRow, error: fxError } = await supabase
      .from("football_fixtures")
      .select(
        "id, home_team_id, away_team_id, api_home_team_id, api_away_team_id"
      )
      .eq("api_fixture_id", apiFixtureId)
      .maybeSingle();
    if (fxError)
      throw new Error(`Erro ao buscar fixture local: ${fxError.message}`);
    if (!fixtureRow)
      throw new Error(
        `Fixture local não encontrada para api_fixture_id=${apiFixtureId}.`
      );

    const fixtureId: string = fixtureRow.id;
    const homeTeamId: string | null = fixtureRow.home_team_id;
    const awayTeamId: string | null = fixtureRow.away_team_id;
    const apiHomeTeamId: number | null = fixtureRow.api_home_team_id;
    const apiAwayTeamId: number | null = fixtureRow.api_away_team_id;

    function resolveTeams(apiTeamId: number): {
      teamId: string | null;
      opponentTeamId: string | null;
    } {
      if (apiTeamId === apiHomeTeamId)
        return { teamId: homeTeamId, opponentTeamId: awayTeamId };
      if (apiTeamId === apiAwayTeamId)
        return { teamId: awayTeamId, opponentTeamId: homeTeamId };
      return { teamId: null, opponentTeamId: null };
    }

    const body = await apiFootballGet<
      ApiFootballEnvelope<RawApiFixturePlayersBlock[]>
    >("/fixtures/players", { fixture: apiFixtureId });
    const blocks = body.response ?? [];

    // Refresh: apaga registros antigos do fixture.
    await supabase
      .from("football_player_match_stats")
      .delete()
      .eq("fixture_id", fixtureId);

    // Coletar players para upsert básico.
    const playerBasics: Array<{
      api_player_id: number;
      name: string;
      current_team_id: string | null;
    }> = [];
    const rows: Array<Record<string, unknown>> = [];

    for (const block of blocks) {
      const { teamId, opponentTeamId } = resolveTeams(block.team.id);
      for (const entry of block.players ?? []) {
        const stat = entry.statistics?.[0];
        if (!stat) continue;
        const apiPlayerId = entry.player.id;

        playerBasics.push({
          api_player_id: apiPlayerId,
          name: entry.player.name,
          current_team_id: teamId,
        });

        rows.push({
          fixture_id: fixtureId,
          team_id: teamId,
          opponent_team_id: opponentTeamId,
          api_player_id: apiPlayerId,
          player_name: entry.player.name,
          position: stat.games?.position ?? null,
          minutes: stat.games?.minutes ?? 0,
          rating:
            stat.games?.rating != null
              ? Number(stat.games.rating)
              : null,
          shots_total: stat.shots?.total ?? 0,
          shots_on: stat.shots?.on ?? 0,
          goals: stat.goals?.total ?? 0,
          assists: stat.goals?.assists ?? 0,
          passes_total: stat.passes?.total ?? 0,
          passes_key: stat.passes?.key ?? 0,
          tackles_total: stat.tackles?.total ?? 0,
          interceptions: stat.tackles?.interceptions ?? 0,
          duels_total: stat.duels?.total ?? 0,
          duels_won: stat.duels?.won ?? 0,
          dribbles_attempts: stat.dribbles?.attempts ?? 0,
          dribbles_success: stat.dribbles?.success ?? 0,
          fouls_drawn: stat.fouls?.drawn ?? 0,
          fouls_committed: stat.fouls?.committed ?? 0,
          yellow_cards: stat.cards?.yellow ?? 0,
          red_cards: stat.cards?.red ?? 0,
          raw_json: entry,
        });
      }
    }

    // ANTI-DUPLICATE no upsert de football_players (UNIQUE em
    // api_player_id). API-Football pode entregar o mesmo jogador 2x
    // (substituto que aparece em duas listas). Sem dedupe, Postgres
    // joga "ON CONFLICT DO UPDATE command cannot affect row a second
    // time".
    const [dedupedPlayerBasics, duplicatePlayersDropped] = dedupeByKey(
      playerBasics,
      (p) => String(p.api_player_id),
      // Em colisão, prefere o que tem current_team_id resolvido.
      (p) => (p.current_team_id ? 1 : 0)
    );

    if (dedupedPlayerBasics.length > 0) {
      const { error: pErr } = await supabase
        .from("football_players")
        .upsert(dedupedPlayerBasics, { onConflict: "api_player_id" });
      if (pErr)
        throw new Error(`Erro ao upsert players: ${pErr.message}`);

      // Resolver player_id local para preencher rows
      const apiIds = dedupedPlayerBasics.map((p) => p.api_player_id);
      const { data: locals } = await supabase
        .from("football_players")
        .select("id, api_player_id")
        .in("api_player_id", apiIds);
      const playerIdByApi = new Map<number, string>();
      for (const lp of locals ?? []) {
        if (lp.api_player_id != null) playerIdByApi.set(lp.api_player_id, lp.id);
      }
      for (const r of rows) {
        const api = r.api_player_id as number;
        r.player_id = playerIdByApi.get(api) ?? null;
      }
    }

    // ANTI-DUPLICATE em football_player_match_stats. A tabela não tem
    // UNIQUE composto, mas inserir o mesmo (fixture, player) duas
    // vezes polui o histórico e quebra getPlayerLastMatches. Em
    // colisão, mantém o registro com mais sinal (soma das ações).
    function statsScore(r: Record<string, unknown>): number {
      const fields = [
        "minutes",
        "shots_total",
        "shots_on",
        "fouls_committed",
        "fouls_drawn",
        "tackles_total",
        "interceptions",
        "passes_total",
        "passes_key",
        "duels_total",
        "duels_won",
        "yellow_cards",
        "red_cards",
      ] as const;
      let s = 0;
      for (const f of fields) {
        const v = r[f];
        if (typeof v === "number" && Number.isFinite(v)) s += v;
      }
      return s;
    }
    const [dedupedRows, duplicateStatsDropped] = dedupeByKey(
      rows,
      (r) => `${r.fixture_id as string}|${r.api_player_id as number}`,
      statsScore
    );

    if (dedupedRows.length > 0) {
      const { error: insErr } = await supabase
        .from("football_player_match_stats")
        .insert(dedupedRows);
      if (insErr)
        throw new Error(`Erro ao salvar player stats: ${insErr.message}`);
    }

    const result: SyncFixturePlayerStatsResult = {
      syncRunId,
      api_fixture_id: apiFixtureId,
      total_player_stats: dedupedRows.length,
      duplicate_players_dropped: duplicatePlayersDropped,
      duplicate_stats_dropped: duplicateStatsDropped,
    };

    await finishSyncRun(syncRunId, {
      status: "success",
      records_created: result.total_player_stats,
      metadata: {
        api_fixture_id: apiFixtureId,
        total_player_stats: result.total_player_stats,
        duplicate_players_dropped: result.duplicate_players_dropped,
        duplicate_stats_dropped: result.duplicate_stats_dropped,
      },
    });

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishSyncRun(syncRunId, {
      status: "error",
      error_message: message,
    });
    throw err;
  }
}

// ============================================================
// Helpers de leitura (sem ir à API)
// ============================================================

export async function getSavedFixturesByDate(date: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("football_fixtures")
    .select("*")
    .eq("date", date)
    .order("kickoff_at", { ascending: true });
  if (error)
    throw new Error(`Erro ao buscar fixtures salvas: ${error.message}`);
  return data ?? [];
}
