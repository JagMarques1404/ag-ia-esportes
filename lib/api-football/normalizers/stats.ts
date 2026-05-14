import "@/lib/server-only-guard";

export interface RawApiStatistic {
  type: string;
  value: number | string | null;
}

export interface RawApiTeamStatBlock {
  team: { id: number; name: string };
  statistics: RawApiStatistic[];
}

export interface NormalizedTeamStatRow {
  fixture_id: string;
  team_id: string | null;
  opponent_team_id: string | null;
  shots_total: number;
  shots_on: number;
  shots_off: number;
  blocked_shots: number;
  corners: number;
  fouls: number;
  yellow_cards: number;
  red_cards: number;
  possession: number | null;
  passes: number | null;
  passes_accurate: number | null;
  attacks: number | null;
  dangerous_attacks: number | null;
  raw_json: unknown;
}

function toInt(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Math.round(v);
  if (typeof v === "string") {
    const n = parseInt(v.replace("%", ""), 10);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

function toIntOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Math.round(v);
  if (typeof v === "string") {
    const n = parseInt(v.replace("%", ""), 10);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function toNumOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace("%", ""));
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

export function normalizeTeamStats(
  block: RawApiTeamStatBlock,
  fixtureId: string,
  teamId: string | null,
  opponentTeamId: string | null
): NormalizedTeamStatRow {
  const map = new Map<string, number | string | null>();
  for (const s of block.statistics ?? []) {
    map.set(s.type, s.value);
  }
  return {
    fixture_id: fixtureId,
    team_id: teamId,
    opponent_team_id: opponentTeamId,
    shots_total: toInt(map.get("Total Shots")),
    shots_on: toInt(map.get("Shots on Goal")),
    shots_off: toInt(map.get("Shots off Goal")),
    blocked_shots: toInt(map.get("Blocked Shots")),
    corners: toInt(map.get("Corner Kicks")),
    fouls: toInt(map.get("Fouls")),
    yellow_cards: toInt(map.get("Yellow Cards")),
    red_cards: toInt(map.get("Red Cards")),
    possession: toNumOrNull(map.get("Ball Possession")),
    passes: toIntOrNull(map.get("Total passes")),
    passes_accurate: toIntOrNull(map.get("Passes accurate")),
    attacks: null,
    dangerous_attacks: null,
    raw_json: block,
  };
}
