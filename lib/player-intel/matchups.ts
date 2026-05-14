import "@/lib/server-only-guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Archetype, ApiPosition } from "./archetypes";

export type MatchupZone =
  | "right-flank"
  | "left-flank"
  | "central-attack"
  | "central-midfield"
  | "central-defense"
  | "set-piece"
  | "unknown";

export interface DirectMatchup {
  fixture_id: string;
  api_fixture_id: number;
  player_id: string | null;
  api_player_id: number | null;
  player_name: string;
  player_team_id: string | null;
  player_position: string | null;
  player_archetype: Archetype | null;
  opponent_player_id: string | null;
  opponent_api_player_id: number | null;
  opponent_name: string;
  opponent_team_id: string | null;
  opponent_position: string | null;
  opponent_archetype: Archetype | null;
  matchup_zone: MatchupZone;
  advantage_score: number;
  risk_score: number;
  explanation_json: Record<string, unknown>;
}

interface LineupPlayerRow {
  player_id: string | null;
  api_player_id: number | null;
  player_name: string | null;
  team_id: string | null;
  position: string | null;
  grid: string | null;
  is_starting: boolean | null;
}

interface LineupTeamRow {
  team_id: string | null;
  api_team_id: number | null;
}

function bucketize(pos: ApiPosition): "G" | "D" | "M" | "F" | "?" {
  if (!pos) return "?";
  const p = pos.toString().toUpperCase().slice(0, 1);
  if (p === "G" || p === "D" || p === "M" || p === "F") return p;
  return "?";
}

/**
 * Heurística de zona a partir da posição (G/D/M/F) + grid (linha:coluna
 * vinda do API-Football).
 *
 * grid format: "linha:coluna" — 1 é a linha mais defensiva, coluna 1
 * é o lado direito (do mandante). Sem grid, cai em zona "central".
 */
function inferZoneFromPosition(pos: ApiPosition, grid: string | null): MatchupZone {
  const b = bucketize(pos);
  if (b === "G") return "set-piece"; // só interessa em escanteios
  const col = grid && grid.includes(":") ? parseInt(grid.split(":")[1], 10) : NaN;
  if (b === "F") {
    if (Number.isFinite(col)) {
      if (col <= 2) return "right-flank";
      if (col >= 4) return "left-flank";
    }
    return "central-attack";
  }
  if (b === "M") {
    if (Number.isFinite(col)) {
      if (col <= 2) return "right-flank";
      if (col >= 4) return "left-flank";
    }
    return "central-midfield";
  }
  if (b === "D") {
    if (Number.isFinite(col)) {
      if (col <= 2) return "left-flank"; // lateral direito do time defendendo o flanco esquerdo do ataque
      if (col >= 4) return "right-flank";
    }
    return "central-defense";
  }
  return "unknown";
}

/**
 * Mapeia confrontos por sobreposição de zona.
 *
 * Estratégia v0.1:
 *  - Para cada player titular do time A, tentar achar o titular do time B
 *    cuja zona é a contra-posição natural.
 *  - Right-flank de A vs Left-flank de B (atacante vs lateral, etc.)
 *  - Central-attack de A vs Central-defense de B.
 *  - Central-midfield A vs Central-midfield B.
 *  - Sem grid, mapeia por posição F↔D, M↔M.
 *
 * O caller é quem traz `archetypeOf(api_player_id)` para enriquecer os
 * matchups depois (recent-form precisa estar calculado).
 */
export async function mapDirectMatchups(
  fixtureId: string
): Promise<DirectMatchup[]> {
  const supabase = getSupabaseAdmin();

  const { data: fixture, error: fxError } = await supabase
    .from("football_fixtures")
    .select(
      "id, api_fixture_id, home_team_id, away_team_id, api_home_team_id, api_away_team_id"
    )
    .eq("id", fixtureId)
    .maybeSingle();
  if (fxError) throw new Error(`mapDirectMatchups: ${fxError.message}`);
  if (!fixture) throw new Error(`Fixture não encontrada: ${fixtureId}`);

  // TS narrowing não atravessa closures — capturar em const locais.
  const fxId: string = fixture.id;
  const apiFxId: number = fixture.api_fixture_id;
  const homeTeamIdLocal: string | null = fixture.home_team_id;
  const awayTeamIdLocal: string | null = fixture.away_team_id;

  const { data: lineupTeams } = await supabase
    .from("football_lineups")
    .select("team_id, api_team_id")
    .eq("fixture_id", fixtureId);
  const teamRows = (lineupTeams ?? []) as LineupTeamRow[];
  if (teamRows.length === 0) {
    return []; // Sem lineups, sem matchups.
  }

  const { data: lineupPlayers } = await supabase
    .from("football_lineup_players")
    .select(
      "player_id, api_player_id, player_name, team_id, position, grid, is_starting"
    )
    .eq("fixture_id", fixtureId);
  const allPlayers = (lineupPlayers ?? []) as LineupPlayerRow[];

  const homePlayers = allPlayers.filter(
    (p) => p.team_id === homeTeamIdLocal && p.is_starting
  );
  const awayPlayers = allPlayers.filter(
    (p) => p.team_id === awayTeamIdLocal && p.is_starting
  );
  if (homePlayers.length === 0 || awayPlayers.length === 0) {
    return []; // Lineup parcial — não dá pra mapear.
  }

  // Para cada home, escolher o away com zona oposta mais próxima.
  const matchups: DirectMatchup[] = [];

  function pickOpponent(zoneOfHome: MatchupZone): MatchupZone[] {
    // Para um atacante de flanco direito, o oposto natural é o
    // lateral esquerdo do adversário, que defende o flanco direito
    // do mandante = zona "right-flank" pela nossa convenção
    // (porque a zona é descrita do ponto de vista do mandante).
    switch (zoneOfHome) {
      case "right-flank":
        return ["right-flank", "left-flank"];
      case "left-flank":
        return ["left-flank", "right-flank"];
      case "central-attack":
        return ["central-defense", "central-midfield"];
      case "central-midfield":
        return ["central-midfield"];
      case "central-defense":
        return ["central-attack", "central-midfield"];
      case "set-piece":
        return ["set-piece"];
      default:
        return ["central-midfield"];
    }
  }

  function buildMatchupRow(
    me: LineupPlayerRow,
    op: LineupPlayerRow,
    zone: MatchupZone
  ): DirectMatchup {
    return {
      fixture_id: fxId,
      api_fixture_id: apiFxId,
      player_id: me.player_id,
      api_player_id: me.api_player_id,
      player_name: me.player_name ?? "?",
      player_team_id: me.team_id,
      player_position: me.position,
      player_archetype: null,
      opponent_player_id: op.player_id,
      opponent_api_player_id: op.api_player_id,
      opponent_name: op.player_name ?? "?",
      opponent_team_id: op.team_id,
      opponent_position: op.position,
      opponent_archetype: null,
      matchup_zone: zone,
      advantage_score: 0,
      risk_score: 0,
      explanation_json: {
        rule: "v0.1 zone-overlap heuristic",
        player_grid: me.grid,
        opponent_grid: op.grid,
      },
    };
  }

  function pairOneSide(
    side: LineupPlayerRow[],
    other: LineupPlayerRow[],
    invertZoneForSelf = false
  ): void {
    const usedOpponents = new Set<number>();
    for (const me of side) {
      const myZone = inferZoneFromPosition(me.position, me.grid);
      const targetZones = pickOpponent(myZone);
      const candidates = other.filter((o) => {
        if (
          o.api_player_id != null &&
          usedOpponents.has(o.api_player_id)
        )
          return false;
        const oZone = inferZoneFromPosition(o.position, o.grid);
        return targetZones.includes(oZone);
      });
      if (candidates.length === 0) continue;
      // Heurística simples: pega o primeiro disponível. Em v0.2,
      // resolver por proximidade real do grid.
      const opp = candidates[0];
      if (opp.api_player_id != null) usedOpponents.add(opp.api_player_id);
      const usedZone = invertZoneForSelf
        ? inferZoneFromPosition(opp.position, opp.grid)
        : myZone;
      matchups.push(buildMatchupRow(me, opp, usedZone));
    }
  }

  pairOneSide(homePlayers, awayPlayers, false);
  pairOneSide(awayPlayers, homePlayers, true);

  return matchups;
}

export async function upsertPlayerMatchups(
  matchups: DirectMatchup[]
): Promise<number> {
  if (matchups.length === 0) return 0;
  const supabase = getSupabaseAdmin();
  // Refresh por fixture: deleta e insere.
  const fixtureIds = Array.from(new Set(matchups.map((m) => m.fixture_id)));
  await supabase
    .from("football_player_matchups")
    .delete()
    .in("fixture_id", fixtureIds);

  const rows = matchups.map((m) => ({
    fixture_id: m.fixture_id,
    api_fixture_id: m.api_fixture_id,
    player_id: m.player_id,
    opponent_player_id: m.opponent_player_id,
    matchup_zone: m.matchup_zone,
    player_archetype: m.player_archetype,
    opponent_archetype: m.opponent_archetype,
    advantage_score: m.advantage_score,
    risk_score: m.risk_score,
    explanation_json: m.explanation_json,
  }));

  const { error } = await supabase
    .from("football_player_matchups")
    .insert(rows);
  if (error) throw new Error(`upsertPlayerMatchups: ${error.message}`);
  return rows.length;
}
