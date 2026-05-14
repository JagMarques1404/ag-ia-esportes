import "server-only";
import type { RawApiLeague } from "./leagues";
import type { RawApiTeam } from "./teams";

export interface RawApiFixtureBlock {
  fixture: {
    id: number;
    referee?: string | null;
    timezone?: string;
    date: string;
    timestamp: number;
    venue?: { id?: number | null; name?: string | null; city?: string | null };
    status?: { long?: string; short?: string; elapsed?: number | null };
  };
  league: RawApiLeague;
  teams: { home: RawApiTeam; away: RawApiTeam };
  goals?: { home: number | null; away: number | null };
  score?: unknown;
}

export interface NormalizedFixtureRow {
  api_fixture_id: number;
  date: string;
  kickoff_at: string;
  timezone: string | null;
  league_id: string | null;
  api_league_id: number;
  league_name: string;
  season: number | null;
  round: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  api_home_team_id: number;
  api_away_team_id: number;
  home_team_name: string;
  away_team_name: string;
  status: string | null;
  elapsed: number | null;
  goals_home: number | null;
  goals_away: number | null;
  venue_name: string | null;
  referee: string | null;
  raw_json: unknown;
}

export function normalizeFixture(
  block: RawApiFixtureBlock,
  leagueId: string | null = null,
  homeTeamId: string | null = null,
  awayTeamId: string | null = null
): NormalizedFixtureRow {
  const dateIso = block.fixture.date;
  const dateOnly = dateIso.split("T")[0];
  return {
    api_fixture_id: block.fixture.id,
    date: dateOnly,
    kickoff_at: dateIso,
    timezone: block.fixture.timezone ?? null,
    league_id: leagueId,
    api_league_id: block.league.id,
    league_name: block.league.name,
    season: block.league.season ?? null,
    round: block.league.round ?? null,
    home_team_id: homeTeamId,
    away_team_id: awayTeamId,
    api_home_team_id: block.teams.home.id,
    api_away_team_id: block.teams.away.id,
    home_team_name: block.teams.home.name,
    away_team_name: block.teams.away.name,
    status: block.fixture.status?.short ?? null,
    elapsed: block.fixture.status?.elapsed ?? null,
    goals_home: block.goals?.home ?? null,
    goals_away: block.goals?.away ?? null,
    venue_name: block.fixture.venue?.name ?? null,
    referee: block.fixture.referee ?? null,
    raw_json: block,
  };
}
