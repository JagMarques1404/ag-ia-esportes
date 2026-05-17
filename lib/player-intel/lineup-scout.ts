import "@/lib/server-only-guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  resolveManualPlayerLocal,
  resolveManualPlayerViaApi,
  upsertAlias,
} from "./player-identity-resolver";

/**
 * Lineup Scout externo — Fase E.0A.14.
 *
 * Quando o API-Football não retorna lineup para um fixture, o usuário
 * cola uma escalação provável/confirmada de fonte externa (FutStats,
 * FotMob, SofaScore, Flashscore, boletim do clube).
 *
 * Esta camada faz:
 *   1. salva raw_text em football_external_lineup_sources
 *   2. parseia jogadores por time (parser flexível: "Athletico-PR: A, B, C ; Flamengo: X, Y, Z")
 *   3. cria/upsert football_lineups + football_lineup_players com
 *      source='external_predicted' ou 'external_confirmed'
 *   4. resolve cada jogador via resolver local (fuzzy)
 *   5. (caller chama processOneFixture/runFixturePlayerIntel separado)
 *
 * Não chama API externa. Não inventa jogador (sem nome canônico = pula).
 */

const SYNTHETIC_API_PLAYER_ID_MIN = 800_000_000;

export interface ParsedTeamLineup {
  team_label: string;        // ex.: "Athletico-PR" / "home" / "fluminense"
  formation: string | null;  // ex.: "4-2-3-1"
  players: ParsedPlayer[];
}

export interface ParsedPlayer {
  name: string;
  position: "G" | "D" | "M" | "F" | null;
  /** Linha onde apareceu no texto original (debug). */
  raw: string;
}

export interface ParsedLineupText {
  home: ParsedTeamLineup | null;
  away: ParsedTeamLineup | null;
  /** Se o parser não conseguiu distinguir home/away, devolve só `teams`. */
  teams: ParsedTeamLineup[];
}

// ============================================================
// Parser
// ============================================================

const FORMATION_RE = /\b(\d-\d(?:-\d){0,2})\b/;

/**
 * Parser flexível. Aceita formatos comuns:
 *
 *   "Athletico-PR (4-2-3-1): Bento; Madson, Belezi, ...;
 *    Flamengo (4-3-3): Rossi; Wesley, ..."
 *
 *   "Athletico-PR
 *    Bento, Madson, Belezi, ...
 *    Flamengo
 *    Rossi, Wesley, ..."
 *
 *   "Bento, Madson, Belezi, ... vs Rossi, Wesley, ..."
 *
 * Heurística: separa por linhas, identifica blocos por presença de ":" /
 * "vs" / cabeçalho-time. Sem hardcoding de nomes de times.
 */
export function parseLineupFromText(text: string): ParsedLineupText {
  if (!text || text.trim().length === 0) {
    return { home: null, away: null, teams: [] };
  }

  // Normaliza quebras de linha
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const teams: ParsedTeamLineup[] = [];
  let currentLabel: string | null = null;
  let currentFormation: string | null = null;
  let currentPlayers: ParsedPlayer[] = [];

  function flush(): void {
    if (currentLabel && currentPlayers.length > 0) {
      teams.push({
        team_label: currentLabel,
        formation: currentFormation,
        players: currentPlayers,
      });
    }
    currentLabel = null;
    currentFormation = null;
    currentPlayers = [];
  }

  // Strategy: lê linha por linha. Detecta "headers" (linhas curtas sem
  // separadores de player) como nome do time, ou linhas com ":" cujo
  // antes do ":" é o time.
  for (const line of lines) {
    // Pula linhas de instrução
    if (/^(escala|lineup|prov[áa]vel|confirmad|formac)/i.test(line)) {
      // Pode conter formação na mesma linha — extrai
      const fm = FORMATION_RE.exec(line)?.[1];
      if (fm) currentFormation = fm;
      continue;
    }

    // "Time (4-2-3-1): A, B, C, ..."
    const headerWithPlayers = line.match(
      /^([^:()]{2,40}?)(?:\s*\(([^)]+)\))?\s*[:]\s*(.+)$/
    );
    if (headerWithPlayers) {
      flush();
      currentLabel = headerWithPlayers[1].trim();
      const fmIn = headerWithPlayers[2];
      currentFormation = fmIn && FORMATION_RE.test(fmIn) ? FORMATION_RE.exec(fmIn)![1] : null;
      const rest = headerWithPlayers[3];
      currentPlayers = parsePlayersFromText(rest, currentFormation);
      flush();
      continue;
    }

    // Linha curta sem separadores típicos de player → header de time
    const looksLikeHeader =
      line.length <= 60 &&
      !/[,;]/.test(line) &&
      /[a-zA-ZÀ-ÿ]/.test(line) &&
      line.split(/\s+/).length <= 6;
    if (looksLikeHeader) {
      flush();
      currentLabel = line.replace(/[()]/g, "").replace(/\d-\d.*$/, "").trim();
      currentFormation = FORMATION_RE.exec(line)?.[1] ?? null;
      continue;
    }

    // Caso contrário: assume que é uma linha de jogadores para o team corrente
    if (currentLabel) {
      currentPlayers.push(...parsePlayersFromText(line, currentFormation));
    } else {
      // Sem time corrente — cria um "team_label" placeholder pra não perder
      currentLabel = teams.length === 0 ? "home" : "away";
      currentPlayers.push(...parsePlayersFromText(line, currentFormation));
    }
  }
  flush();

  // Decide home/away: primeiro = home, segundo = away
  const home = teams[0] ?? null;
  const away = teams[1] ?? null;
  return { home, away, teams };
}

function parsePlayersFromText(
  raw: string,
  formation: string | null
): ParsedPlayer[] {
  // Separa por ; , — • | mantendo ordem
  const tokens = raw
    .replace(/\.\s*$/, "")
    .split(/[;,•|—–]/)
    .map((t) => t.trim())
    .map((t) => t.replace(/^[\s\-•*]+/, "").trim())
    .filter((t) => t.length >= 2 && t.length <= 40);

  // Distribui posições por formação (igual ao seed-manual-lineups)
  const positions = distributePositions(formation, tokens.length);
  return tokens.map((name, i) => ({
    name,
    position: positions[i] ?? null,
    raw: name,
  }));
}

function distributePositions(
  formation: string | null,
  totalTokens: number
): Array<ParsedPlayer["position"]> {
  if (!formation) return new Array(totalTokens).fill(null);
  const parts = formation.split("-").map((s) => parseInt(s.trim(), 10));
  if (!parts.every((n) => Number.isFinite(n) && n > 0)) {
    return new Array(totalTokens).fill(null);
  }
  const positions: Array<ParsedPlayer["position"]> = ["G"];
  const def = parts[0];
  const fwd = parts[parts.length - 1];
  const mid = parts.slice(1, -1).reduce((a, b) => a + b, 0);
  for (let i = 0; i < def; i++) positions.push("D");
  for (let i = 0; i < mid; i++) positions.push("M");
  for (let i = 0; i < fwd; i++) positions.push("F");
  // Ajusta tamanho ao número de tokens
  while (positions.length < totalTokens) positions.push(null);
  return positions.slice(0, totalTokens);
}

// ============================================================
// Hash sintético (compatível com seed-manual-lineups)
// ============================================================

function normName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function syntheticApiPlayerId(playerName: string, teamSlug: string): number {
  const s = `${playerName}|${teamSlug}`.toLowerCase().normalize("NFKD");
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  const positive = Math.abs(h) % 200_000_000;
  return SYNTHETIC_API_PLAYER_ID_MIN + positive;
}

// ============================================================
// Save external lineup
// ============================================================

export interface SaveExternalLineupInput {
  apiFixtureId: number;
  sourceName: string;
  sourceUrl?: string | null;
  sourceType: "predicted" | "confirmed" | "manual" | "squad_preview";
  text: string;
  /** Se true, tenta resolver via API quando local falha. Default false. */
  resolveApi?: boolean;
  apiLimit?: number;
}

export interface SaveExternalLineupResult {
  external_source_id: string;
  parsed: ParsedLineupText;
  inserted_players: number;
  matched_real: number;
  matched_no_history: number;
  synthetic_fallback: number;
  ambiguous: number;
  /** Quem ficou unresolved precisa de input manual. */
  unresolved: Array<{ name: string; team: string }>;
  warnings: string[];
}

interface FixtureLite {
  id: string;
  api_fixture_id: number;
  home_team_id: string | null;
  away_team_id: string | null;
  home_team_name: string | null;
  away_team_name: string | null;
  api_home_team_id: number | null;
  api_away_team_id: number | null;
}

async function loadFixtureLite(apiFixtureId: number): Promise<FixtureLite | null> {
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from("football_fixtures")
    .select(
      "id, api_fixture_id, home_team_id, away_team_id, home_team_name, away_team_name, api_home_team_id, api_away_team_id"
    )
    .eq("api_fixture_id", apiFixtureId)
    .maybeSingle();
  return (data as FixtureLite) ?? null;
}

export async function saveExternalLineup(
  input: SaveExternalLineupInput
): Promise<SaveExternalLineupResult> {
  const sb = getSupabaseAdmin();
  const fixture = await loadFixtureLite(input.apiFixtureId);
  if (!fixture) {
    throw new Error(`Fixture ${input.apiFixtureId} não está em football_fixtures.`);
  }

  const parsed = parseLineupFromText(input.text);
  const warnings: string[] = [];
  if (!parsed.home && !parsed.away && parsed.teams.length === 0) {
    throw new Error(
      "Parser não identificou nenhum time. Cole com formato: 'TimeA: J1, J2, ...; TimeB: J1, J2, ...'"
    );
  }

  // 1. Salva raw em external_lineup_sources
  const { data: extRow, error: extErr } = await sb
    .from("football_external_lineup_sources")
    .insert({
      api_fixture_id: input.apiFixtureId,
      fixture_id: fixture.id,
      source_name: input.sourceName,
      source_url: input.sourceUrl ?? null,
      source_type: input.sourceType,
      raw_text: input.text,
      parsed_json: parsed as unknown as object,
      confidence: input.sourceType === "confirmed" ? 0.95 : 0.7,
    })
    .select("id")
    .single();
  if (extErr || !extRow) {
    throw new Error(`save external_lineup_sources: ${extErr?.message}`);
  }
  const externalSourceId = extRow.id as string;

  // 2. Apaga lineups externas anteriores deste fixture (idempotência)
  await sb
    .from("football_lineups")
    .delete()
    .eq("fixture_id", fixture.id)
    .in("source", ["external_predicted", "external_confirmed"]);

  // 3. Para cada team parseado, cria football_lineups + lineup_players
  const sourceLineup =
    input.sourceType === "confirmed" ? "external_confirmed" : "external_predicted";
  const sourcePlayers = sourceLineup;

  let insertedPlayers = 0;
  let matchedReal = 0;
  let matchedNoHistory = 0;
  let syntheticFallback = 0;
  let ambiguousCount = 0;
  const unresolved: Array<{ name: string; team: string }> = [];

  const sides: Array<{
    parsedTeam: ParsedTeamLineup | null;
    teamId: string | null;
    apiTeamId: number | null;
    teamName: string | null;
  }> = [
    {
      parsedTeam: parsed.home,
      teamId: fixture.home_team_id,
      apiTeamId: fixture.api_home_team_id,
      teamName: fixture.home_team_name,
    },
    {
      parsedTeam: parsed.away,
      teamId: fixture.away_team_id,
      apiTeamId: fixture.api_away_team_id,
      teamName: fixture.away_team_name,
    },
  ];

  for (const side of sides) {
    if (!side.parsedTeam) continue;
    if (!side.teamId) {
      warnings.push(
        `time ${side.teamName ?? side.parsedTeam.team_label} sem team_id local — pulando`
      );
      continue;
    }
    const teamSlug = normName(side.teamName ?? side.parsedTeam.team_label);

    // 3a. Resolve cada jogador
    interface ResolvedSeed {
      playerName: string;
      position: ParsedPlayer["position"];
      api_player_id: number;
      football_player_id: string | null;
      status: string;
    }
    const resolved: ResolvedSeed[] = [];
    for (const p of side.parsedTeam.players) {
      let r = await resolveManualPlayerLocal({
        playerName: p.name,
        teamName: side.teamName ?? null,
        apiTeamId: side.apiTeamId,
      });
      if (
        input.resolveApi &&
        (r.status === "unmatched" || r.status === "ambiguous") &&
        (input.apiLimit ?? 0) > 0
      ) {
        const api = await resolveManualPlayerViaApi({
          playerName: p.name,
          teamName: side.teamName ?? null,
          apiTeamId: side.apiTeamId,
        });
        if (api.status === "matched" || api.status === "matched_no_history") {
          r = api;
        }
      }
      await upsertAlias(
        {
          playerName: p.name,
          teamName: side.teamName ?? null,
          apiTeamId: side.apiTeamId,
        },
        r
      );

      if (
        (r.status === "matched" || r.status === "matched_no_history") &&
        r.api_player_id != null
      ) {
        resolved.push({
          playerName: p.name,
          position: p.position,
          api_player_id: r.api_player_id,
          football_player_id: r.football_player_id,
          status: r.status,
        });
        if (r.status === "matched") matchedReal++;
        else matchedNoHistory++;
      } else {
        if (r.status === "ambiguous") ambiguousCount++;
        const syn = syntheticApiPlayerId(p.name, teamSlug);
        resolved.push({
          playerName: p.name,
          position: p.position,
          api_player_id: syn,
          football_player_id: null,
          status: r.status === "ambiguous" ? "ambiguous" : "synthetic_fallback",
        });
        syntheticFallback++;
        if (r.status === "unmatched") {
          unresolved.push({
            name: p.name,
            team: side.teamName ?? side.parsedTeam.team_label,
          });
        }
      }
    }

    // 3b. Upsert sintéticos em football_players
    const syntheticBasics = resolved
      .filter((r) => r.api_player_id >= SYNTHETIC_API_PLAYER_ID_MIN)
      .map((r) => ({
        api_player_id: r.api_player_id,
        name: r.playerName,
        current_team_id: side.teamId,
      }));
    const seen = new Set<number>();
    const dedupedSynth = syntheticBasics.filter((p) => {
      if (seen.has(p.api_player_id)) return false;
      seen.add(p.api_player_id);
      return true;
    });
    let synthByApi = new Map<number, string>();
    if (dedupedSynth.length > 0) {
      const { error: pErr } = await sb
        .from("football_players")
        .upsert(dedupedSynth, { onConflict: "api_player_id" });
      if (pErr) {
        warnings.push(`upsert players (${side.teamName}): ${pErr.message}`);
      }
      const { data: locals } = await sb
        .from("football_players")
        .select("id, api_player_id")
        .in(
          "api_player_id",
          dedupedSynth.map((p) => p.api_player_id)
        );
      for (const lp of locals ?? [])
        if (lp.api_player_id != null)
          synthByApi.set(lp.api_player_id, lp.id as string);
    }

    // 3c. Cria football_lineups
    const { data: lineupRow, error: lErr } = await sb
      .from("football_lineups")
      .insert({
        fixture_id: fixture.id,
        team_id: side.teamId,
        api_team_id: side.apiTeamId,
        formation: side.parsedTeam.formation,
        is_confirmed: input.sourceType === "confirmed",
        source: sourceLineup,
        source_url: input.sourceUrl ?? null,
        source_confidence: input.sourceType === "confirmed" ? 0.95 : 0.7,
        raw_source: input.sourceName,
      })
      .select("id")
      .single();
    if (lErr || !lineupRow) {
      warnings.push(`insert lineup (${side.teamName}): ${lErr?.message}`);
      continue;
    }

    // 3d. Cria lineup_players
    const lpRows = resolved.map((r) => ({
      lineup_id: lineupRow.id as string,
      fixture_id: fixture.id,
      team_id: side.teamId,
      api_player_id: r.api_player_id,
      player_id: r.football_player_id ?? synthByApi.get(r.api_player_id) ?? null,
      player_name: r.playerName,
      position: r.position,
      grid: null,
      number: null,
      is_starting: true,
      source: sourcePlayers,
    }));
    const { error: lpErr } = await sb
      .from("football_lineup_players")
      .insert(lpRows);
    if (lpErr) {
      warnings.push(`insert lineup_players (${side.teamName}): ${lpErr.message}`);
      continue;
    }
    insertedPlayers += lpRows.length;
  }

  return {
    external_source_id: externalSourceId,
    parsed,
    inserted_players: insertedPlayers,
    matched_real: matchedReal,
    matched_no_history: matchedNoHistory,
    synthetic_fallback: syntheticFallback,
    ambiguous: ambiguousCount,
    unresolved,
    warnings,
  };
}

// ============================================================
// Generate board from external lineup
// ============================================================

/**
 * Wrapper: salva lineup externa + processa fixture (last5 + board +
 * readiness + picks).
 *
 * Útil para a API route /api/studio/external-lineup chamar de uma vez.
 */
export async function saveAndProcessExternalLineup(args: {
  input: SaveExternalLineupInput;
  /** Se true, faz processOneFixture com dryRun=false após salvar. */
  generateBoard: boolean;
}): Promise<{
  save: SaveExternalLineupResult;
  board: Awaited<ReturnType<typeof import("./fixture-processor").processOneFixture>> | null;
}> {
  const save = await saveExternalLineup(args.input);
  if (!args.generateBoard) {
    return { save, board: null };
  }
  const { processOneFixture } = await import("./fixture-processor");
  const board = await processOneFixture({
    apiFixtureId: args.input.apiFixtureId,
    dryRun: false,
    last: 5,
    persistSchedule: true,
  });
  return { save, board };
}
