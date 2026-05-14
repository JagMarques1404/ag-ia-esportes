import "server-only";

export interface RawApiTeam {
  id: number;
  name: string;
  logo?: string;
  winner?: boolean | null;
}

export interface NormalizedTeamRow {
  api_team_id: number;
  name: string;
  logo: string | null;
  raw_json: unknown;
}

export function normalizeTeamFromFixture(apiTeam: RawApiTeam): NormalizedTeamRow {
  return {
    api_team_id: apiTeam.id,
    name: apiTeam.name,
    logo: apiTeam.logo ?? null,
    raw_json: apiTeam,
  };
}
