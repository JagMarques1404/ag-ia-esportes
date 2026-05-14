import "@/lib/server-only-guard";

export interface RawApiLineupPlayerEntry {
  player: {
    id: number;
    name: string;
    number?: number | null;
    pos?: string | null;
    grid?: string | null;
  };
}

export interface RawApiLineup {
  team: { id: number; name: string; logo?: string };
  coach?: { id?: number; name?: string; photo?: string };
  formation?: string;
  startXI?: RawApiLineupPlayerEntry[];
  substitutes?: RawApiLineupPlayerEntry[];
}

export interface NormalizedLineupRow {
  fixture_id: string;
  team_id: string | null;
  api_team_id: number;
  formation: string | null;
  coach_name: string | null;
  is_confirmed: boolean;
  raw_json: unknown;
}

export interface NormalizedLineupPlayerRow {
  fixture_id: string;
  team_id: string | null;
  api_player_id: number;
  player_name: string;
  position: string | null;
  grid: string | null;
  number: number | null;
  is_starting: boolean;
  raw_json: unknown;
}

export function normalizeLineup(
  apiLineup: RawApiLineup,
  fixtureId: string,
  teamId: string | null
): NormalizedLineupRow {
  return {
    fixture_id: fixtureId,
    team_id: teamId,
    api_team_id: apiLineup.team.id,
    formation: apiLineup.formation ?? null,
    coach_name: apiLineup.coach?.name ?? null,
    is_confirmed: !!(apiLineup.startXI && apiLineup.startXI.length > 0),
    raw_json: apiLineup,
  };
}

export function normalizeLineupPlayers(
  apiLineup: RawApiLineup,
  fixtureId: string,
  teamId: string | null
): NormalizedLineupPlayerRow[] {
  const rows: NormalizedLineupPlayerRow[] = [];
  for (const entry of apiLineup.startXI ?? []) {
    rows.push({
      fixture_id: fixtureId,
      team_id: teamId,
      api_player_id: entry.player.id,
      player_name: entry.player.name,
      position: entry.player.pos ?? null,
      grid: entry.player.grid ?? null,
      number: entry.player.number ?? null,
      is_starting: true,
      raw_json: entry,
    });
  }
  for (const entry of apiLineup.substitutes ?? []) {
    rows.push({
      fixture_id: fixtureId,
      team_id: teamId,
      api_player_id: entry.player.id,
      player_name: entry.player.name,
      position: entry.player.pos ?? null,
      grid: entry.player.grid ?? null,
      number: entry.player.number ?? null,
      is_starting: false,
      raw_json: entry,
    });
  }
  return rows;
}
