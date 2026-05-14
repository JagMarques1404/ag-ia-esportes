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
