import "@/lib/server-only-guard";

export interface RawApiLeague {
  id: number;
  name: string;
  country?: string;
  logo?: string;
  flag?: string;
  season?: number;
  round?: string;
  type?: string;
}

export interface NormalizedLeagueRow {
  api_league_id: number;
  name: string;
  country: string | null;
  logo: string | null;
  type: string | null;
  season: number | null;
  raw_json: unknown;
}

export function normalizeLeagueFromFixture(
  apiLeague: RawApiLeague
): NormalizedLeagueRow {
  return {
    api_league_id: apiLeague.id,
    name: apiLeague.name,
    country: apiLeague.country ?? null,
    logo: apiLeague.logo ?? null,
    type: apiLeague.type ?? null,
    season: apiLeague.season ?? null,
    raw_json: apiLeague,
  };
}
