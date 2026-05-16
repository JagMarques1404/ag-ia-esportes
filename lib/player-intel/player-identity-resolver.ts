import "@/lib/server-only-guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Resolver de identidade — tenta ligar um jogador escalado manualmente
 * (ex.: "M. Olise") ao api_player_id real do API-Football usando apenas
 * dados locais em `football_players`.
 *
 * Sem API. Sem fuzzy agressivo. Confiança ≥ 0.85 → substitui ID sintético.
 *
 * Decisões:
 *   - Sempre priorizar candidatos do mesmo team (filtro por current_team_id).
 *   - Aceitar match por "I. Sobrenome" quando há candidato único.
 *   - Rejeitar single-name muito comum (ex.: "Bernardo") sem team filter
 *     — vira "unmatched" em vez de "ambiguous" para evitar gravar links errados.
 */

const SYNTHETIC_API_PLAYER_ID_MIN = 800_000_000;

export interface ResolveInput {
  /** Nome cru como aparece na escalação manual ("M. Olise"). */
  playerName: string;
  /** Nome do time (informativo, para logs/aliases). */
  teamName: string | null;
  /** api_team_id do API-Football, quando conhecido. */
  apiTeamId: number | null;
}

export type ResolveStatus =
  | "matched"
  | "matched_no_history"
  | "ambiguous"
  | "unmatched"
  | "api_blocked";

export interface ResolveResult {
  /** ID real do API-Football quando matched. null caso contrário. */
  api_player_id: number | null;
  /** football_players.id local quando matched. null caso contrário. */
  football_player_id: string | null;
  /** Score de confiança 0..1. */
  confidence: number;
  status: ResolveStatus;
  /** Quantos candidatos passaram pelo filtro inicial. */
  candidates_count: number;
  /** Quantos jogos com stats em football_player_match_stats (FT/AET/PEN). */
  sample_size: number;
  /** Nome resolvido (para logs). */
  matched_name?: string;
  /** Texto explicativo (debug). */
  notes: string;
}

// ============================================================
// Normalização
// ============================================================

/**
 * "Müller" → "muller", "M. Olise" → "m olise", "São Paulo" → "sao paulo".
 * Lowercase, sem diacríticos, pontuação → espaço, espaços colapsados.
 */
export function normalizePlayerName(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // diacritics
    .replace(/[.\-'`"_,/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extrai o "sobrenome" — última palavra >= 3 chars, ignorando palavras
 * curtas como "da", "de", "do" comuns em nomes BR. Se a única palavra
 * for curta, devolve ela mesma.
 */
function extractLastName(normalized: string): string {
  const stopwords = new Set(["da", "de", "do", "das", "dos", "del", "di", "la", "le", "van", "von"]);
  const words = normalized.split(" ").filter((w) => w.length > 0);
  for (let i = words.length - 1; i >= 0; i--) {
    if (words[i].length >= 3 && !stopwords.has(words[i])) return words[i];
  }
  return words[words.length - 1] ?? normalized;
}

/**
 * Extrai a primeira inicial. "m olise" → "m". "michael olise" → "m".
 * Retorna null se nome é só sobrenome.
 */
function extractFirstInitial(normalized: string): string | null {
  const words = normalized.split(" ").filter((w) => w.length > 0);
  if (words.length < 2) return null;
  return words[0][0] ?? null;
}

// ============================================================
// Scoring
// ============================================================

interface CandidateRow {
  id: string;
  api_player_id: number | null;
  name: string;
  firstname: string | null;
  lastname: string | null;
  current_team_id: string | null;
}

/**
 * Calcula score de match entre input e um candidato. 0..1.
 *
 * Thresholds (E.0A.5):
 *   - exact normalized + mesmo time   → 0.98
 *   - exact normalized sem team filter → 0.90 (caller aplica penalty separado)
 *   - inicial + sobrenome + mesmo time → 0.85
 *   - inicial + sobrenome sem time     → 0.70
 *   - substring (>= 5 chars)           → 0.70
 *
 * Esta função devolve o score "raw" sem team filter — o caller aplica
 * o ajuste por team. Vide `resolveManualPlayerLocal`.
 */
function scoreMatch(
  inputName: string,
  inputLastName: string,
  inputInitial: string | null,
  cand: CandidateRow
): { score: number; reason: string } {
  const candName = normalizePlayerName(cand.name);
  const candLast = cand.lastname ? normalizePlayerName(cand.lastname) : extractLastName(candName);
  const candFirst = cand.firstname ? normalizePlayerName(cand.firstname) : "";

  // 1. Exact normalized → base 0.98 (caller pode degradar -0.08 sem team)
  if (candName === inputName) {
    return { score: 0.98, reason: "exact name normalized" };
  }
  // 2. Lastname exato + initial bate
  if (candLast === inputLastName) {
    if (!inputInitial) {
      // Input é só sobrenome. Match sozinho não vira matched.
      return { score: 0.78, reason: "lastname exact (no initial in input)" };
    }
    const candInitial = candFirst[0] ?? candName[0];
    if (candInitial === inputInitial) {
      return { score: 0.85, reason: "lastname + initial match" };
    }
    return { score: 0.55, reason: "lastname only, initial mismatch" };
  }
  // 3. Substring match >= 5 chars
  if (inputName.length >= 5 && (candName.includes(inputName) || inputName.includes(candName))) {
    return { score: 0.7, reason: "substring match" };
  }
  return { score: 0, reason: "no match" };
}

// ============================================================
// History sample
// ============================================================

/**
 * Conta quantos jogos com stats finalizados (FT/AET/PEN) existem em
 * football_player_match_stats para este api_player_id. Usado pelo
 * resolver para decidir `matched` vs `matched_no_history`.
 *
 * Ignora IDs sintéticos (>= 800M) — nunca terão histórico real.
 */
export async function getPlayerHistorySample(
  apiPlayerId: number | null
): Promise<number> {
  if (apiPlayerId == null || apiPlayerId <= 0) return 0;
  if (apiPlayerId >= SYNTHETIC_API_PLAYER_ID_MIN) return 0;
  const supabase = getSupabaseAdmin();
  const { count, error } = await supabase
    .from("football_player_match_stats")
    .select("fixture_id, football_fixtures!inner(status)", {
      count: "exact",
      head: true,
    })
    .eq("api_player_id", apiPlayerId)
    .in("football_fixtures.status", ["FT", "AET", "PEN"]);
  if (error) return 0;
  return count ?? 0;
}

// ============================================================
// Cache do team_id local por api_team_id
// ============================================================

const teamIdCache = new Map<number, string | null>();

async function getLocalTeamId(apiTeamId: number | null): Promise<string | null> {
  if (apiTeamId == null || apiTeamId <= 0) return null;
  if (teamIdCache.has(apiTeamId)) return teamIdCache.get(apiTeamId) ?? null;
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("football_teams")
    .select("id")
    .eq("api_team_id", apiTeamId)
    .maybeSingle();
  const id = (data?.id as string | undefined) ?? null;
  teamIdCache.set(apiTeamId, id);
  return id;
}

// ============================================================
// Entrypoint
// ============================================================

/**
 * Tenta resolver localmente (sem API). Retorna sempre um ResolveResult,
 * incluindo `unmatched` quando ninguém é forte o suficiente.
 *
 * Confiança ≥ 0.85 = matched. Caller deve usar `api_player_id` direto.
 * 0.55..0.85 = ambiguous (registramos pra debug mas NÃO substituímos ID).
 * < 0.55     = unmatched.
 */
export async function resolveManualPlayerLocal(
  input: ResolveInput
): Promise<ResolveResult> {
  const supabase = getSupabaseAdmin();
  const normalized = normalizePlayerName(input.playerName);
  const lastName = extractLastName(normalized);
  const initial = extractFirstInitial(normalized);

  // Guard: nome muito curto (≤ 3 chars) é arriscado demais
  if (normalized.length <= 3) {
    return {
      api_player_id: null,
      football_player_id: null,
      confidence: 0,
      status: "unmatched",
      candidates_count: 0,
      sample_size: 0,
      notes: "nome muito curto (≤ 3 chars)",
    };
  }

  const localTeamId = await getLocalTeamId(input.apiTeamId);

  // Estratégia: pegar candidatos preferencialmente do mesmo time. Se
  // não houver team filter, restringe ao máximo (lastname OR ilike name).
  let candidates: CandidateRow[] = [];
  if (localTeamId) {
    const { data } = await supabase
      .from("football_players")
      .select("id, api_player_id, name, firstname, lastname, current_team_id")
      .eq("current_team_id", localTeamId);
    candidates = (data ?? []) as CandidateRow[];
  } else {
    // Sem team filter: busca por lastname OR name com lastname incluído.
    // Limite defensivo para evitar trazer 5000 jogadores.
    const { data: byLast } = await supabase
      .from("football_players")
      .select("id, api_player_id, name, firstname, lastname, current_team_id")
      .ilike("lastname", lastName)
      .limit(50);
    const { data: byName } = await supabase
      .from("football_players")
      .select("id, api_player_id, name, firstname, lastname, current_team_id")
      .ilike("name", `%${lastName}%`)
      .limit(50);
    const seen = new Set<string>();
    candidates = [...(byLast ?? []), ...(byName ?? [])].filter((r) => {
      const id = r.id as string;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    }) as CandidateRow[];
  }

  // Filtra IDs sintéticos (>= 800M) — não devem virar resolução
  candidates = candidates.filter(
    (c) => c.api_player_id != null && c.api_player_id < SYNTHETIC_API_PLAYER_ID_MIN
  );

  if (candidates.length === 0) {
    return {
      api_player_id: null,
      football_player_id: null,
      confidence: 0,
      status: "unmatched",
      candidates_count: 0,
      sample_size: 0,
      notes: localTeamId
        ? "sem candidatos com team filter (rode collect:player-last5 ou busque player na API)"
        : "sem candidatos globais (lastname não bate em football_players)",
    };
  }

  // Score todos os candidatos
  const scored = candidates
    .map((c) => {
      const { score, reason } = scoreMatch(normalized, lastName, initial, c);
      return { c, score, reason };
    })
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  const runnerUp = scored[1];

  // Sem team filter, penalty -0.08 (degrada exact match de 0.98 para 0.90)
  const teamPenalty = localTeamId ? 0 : 0.08;
  const adjustedTop = Math.max(0, top.score - teamPenalty);

  // Ambíguo: top e runner-up empatam em score alto
  if (
    runnerUp &&
    Math.abs(top.score - runnerUp.score) < 0.05 &&
    top.score >= 0.7 &&
    top.c.id !== runnerUp.c.id
  ) {
    return {
      api_player_id: null,
      football_player_id: null,
      confidence: top.score,
      status: "ambiguous",
      candidates_count: candidates.length,
      sample_size: 0,
      matched_name: top.c.name,
      notes: `ambíguo: ${top.c.name} (${top.score.toFixed(2)}) vs ${runnerUp.c.name} (${runnerUp.score.toFixed(2)}) — diga o jogador certo manualmente`,
    };
  }

  if (adjustedTop >= 0.85) {
    const sample = await getPlayerHistorySample(top.c.api_player_id);
    const status: ResolveStatus = sample > 0 ? "matched" : "matched_no_history";
    return {
      api_player_id: top.c.api_player_id,
      football_player_id: top.c.id,
      confidence: adjustedTop,
      status,
      candidates_count: candidates.length,
      sample_size: sample,
      matched_name: top.c.name,
      notes:
        `${top.reason} (raw=${top.score.toFixed(2)}${teamPenalty ? ", -0.08 sem team filter" : ""}) · sample=${sample}` +
        (sample === 0
          ? " — rode collect:player-last5 para buscar histórico"
          : ""),
    };
  }

  if (adjustedTop >= 0.55) {
    return {
      api_player_id: null,
      football_player_id: null,
      confidence: adjustedTop,
      status: "ambiguous",
      candidates_count: candidates.length,
      sample_size: 0,
      matched_name: top.c.name,
      notes: `score insuficiente: ${top.c.name} ${adjustedTop.toFixed(2)} (${top.reason}) — confirme manualmente`,
    };
  }

  return {
    api_player_id: null,
    football_player_id: null,
    confidence: adjustedTop,
    status: "unmatched",
    candidates_count: candidates.length,
    sample_size: 0,
    notes: `nenhum candidato forte (top: ${top.c.name} ${adjustedTop.toFixed(2)}) — busque na API ou registre alias manual`,
  };
}

// ============================================================
// Persistência do alias
// ============================================================

/**
 * Insere/atualiza alias. Como o unique vive em INDEX (não em UNIQUE
 * constraint), supabase-js .upsert() não consegue usar conflito por
 * expressão — então fazemos delete+insert manual por chave funcional.
 */
export async function upsertAlias(
  input: ResolveInput,
  result: ResolveResult
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const normalized = normalizePlayerName(input.playerName);
  const apiTeamKey = input.apiTeamId ?? 0;
  const apiPlayerKey = result.api_player_id ?? 0;

  // Apaga alias anterior com a mesma tripla funcional, se houver
  await supabase
    .from("player_identity_aliases")
    .delete()
    .eq("normalized_name", normalized)
    // BIGINT compare: usar string ou número diretamente
    .eq("api_team_id", input.apiTeamId)
    .eq("api_player_id", result.api_player_id);
  // Trata os NULL separados (eq não casa null)
  if (input.apiTeamId == null) {
    await supabase
      .from("player_identity_aliases")
      .delete()
      .eq("normalized_name", normalized)
      .is("api_team_id", null)
      .eq("api_player_id", result.api_player_id);
  }
  if (result.api_player_id == null) {
    await supabase
      .from("player_identity_aliases")
      .delete()
      .eq("normalized_name", normalized)
      .eq("api_team_id", input.apiTeamId)
      .is("api_player_id", null);
  }
  if (input.apiTeamId == null && result.api_player_id == null) {
    await supabase
      .from("player_identity_aliases")
      .delete()
      .eq("normalized_name", normalized)
      .is("api_team_id", null)
      .is("api_player_id", null);
  }
  // Suppress unused-var warning
  void apiTeamKey;
  void apiPlayerKey;

  await supabase.from("player_identity_aliases").insert({
    manual_name: input.playerName,
    normalized_name: normalized,
    team_name: input.teamName,
    api_team_id: input.apiTeamId,
    api_player_id: result.api_player_id,
    football_player_id: result.football_player_id,
    confidence_score: result.confidence,
    sample_size: result.sample_size,
    source: result.api_player_id != null ? "api_match" : "local_match",
    status: result.status,
    notes: result.notes,
  });
}

// ============================================================
// Resolver via API (/players/squads?team=ID)
//
// Usado como fallback quando o resolver local não encontra o jogador.
// Custa 1 req por TIME (não por jogador) — caller deve cachear o squad
// entre vários jogadores do mesmo time se chamado em batch.
//
// Plano free do API-Football pode bloquear /players/squads — nesse caso
// retornamos status='api_blocked' para o caller registrar o alias e
// pular sem quebrar o fluxo.
// ============================================================

interface ApiSquadPlayer {
  id: number;
  name: string;
  age?: number | null;
  number?: number | null;
  position?: string | null;
  photo?: string | null;
}

interface ApiSquadBlock {
  team: { id: number; name: string; logo?: string | null };
  players: ApiSquadPlayer[];
}

const squadCache = new Map<number, ApiSquadPlayer[] | "blocked">();

function isPlanLimitError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('"plan"') ||
    m.includes("free plan") ||
    m.includes("do not have access")
  );
}

/**
 * Busca o squad do time no API-Football, cacheia em memória, e tenta
 * casar o jogador via scoring local. Retorna sempre um ResolveResult.
 *
 * Se a API bloqueou (plano free), retorna status='api_blocked' e o
 * caller deve registrar o alias.
 *
 * Importante: NÃO chama API se já está no cache como "blocked". Os
 * caches são por execução (não persistem entre runs).
 */
export async function resolveManualPlayerViaApi(
  input: ResolveInput & { season?: number }
): Promise<ResolveResult> {
  if (input.apiTeamId == null || input.apiTeamId <= 0) {
    return {
      api_player_id: null,
      football_player_id: null,
      confidence: 0,
      status: "unmatched",
      candidates_count: 0,
      sample_size: 0,
      notes: "api_team_id ausente — não dá pra buscar squad",
    };
  }

  let squad = squadCache.get(input.apiTeamId);
  if (squad === "blocked") {
    return {
      api_player_id: null,
      football_player_id: null,
      confidence: 0,
      status: "api_blocked",
      candidates_count: 0,
      sample_size: 0,
      notes: `squad bloqueado pelo plano (team=${input.apiTeamId})`,
    };
  }
  if (squad == null) {
    const { apiFootballGet } = await import("@/lib/api-football/client");
    try {
      const resp = await apiFootballGet<{ response: ApiSquadBlock[] }>(
        "/players/squads",
        { team: input.apiTeamId }
      );
      const block = resp.response?.[0];
      squad = block?.players ?? [];
      squadCache.set(input.apiTeamId, squad);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isPlanLimitError(msg)) {
        squadCache.set(input.apiTeamId, "blocked");
        return {
          api_player_id: null,
          football_player_id: null,
          confidence: 0,
          status: "api_blocked",
          candidates_count: 0,
          sample_size: 0,
          notes: `/players/squads bloqueado pelo plano free: ${msg.slice(0, 120)}`,
        };
      }
      return {
        api_player_id: null,
        football_player_id: null,
        confidence: 0,
        status: "unmatched",
        candidates_count: 0,
        sample_size: 0,
        notes: `erro na API: ${msg.slice(0, 120)}`,
      };
    }
  }

  const normalized = normalizePlayerName(input.playerName);
  const lastName = extractLastName(normalized);
  const initial = extractFirstInitial(normalized);

  if (squad.length === 0) {
    return {
      api_player_id: null,
      football_player_id: null,
      confidence: 0,
      status: "unmatched",
      candidates_count: 0,
      sample_size: 0,
      notes: "squad veio vazio do provider",
    };
  }

  // Scoring direto contra entries do squad. Não tem firstname/lastname
  // separados — divide o name aqui mesmo.
  const scored = squad
    .map((s) => {
      const fake: CandidateRow = {
        id: "", // not relevant
        api_player_id: s.id,
        name: s.name,
        firstname: null,
        lastname: null,
        current_team_id: null,
      };
      const { score, reason } = scoreMatch(normalized, lastName, initial, fake);
      return { s, score, reason };
    })
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  const runnerUp = scored[1];

  // Ambíguo: top e runner-up empatam em score alto
  if (
    runnerUp &&
    Math.abs(top.score - runnerUp.score) < 0.05 &&
    top.score >= 0.7 &&
    top.s.id !== runnerUp.s.id
  ) {
    return {
      api_player_id: null,
      football_player_id: null,
      confidence: top.score,
      status: "ambiguous",
      candidates_count: squad.length,
      sample_size: 0,
      matched_name: top.s.name,
      notes: `API squad ambíguo: ${top.s.name} vs ${runnerUp.s.name} — defina alias manual`,
    };
  }

  if (top.score >= 0.85) {
    // Upsert football_players com este api_player_id real para o pipeline
    // achar player_id depois.
    const localTeamId = await getLocalTeamId(input.apiTeamId);
    const supabase = getSupabaseAdmin();
    await supabase
      .from("football_players")
      .upsert(
        {
          api_player_id: top.s.id,
          name: top.s.name,
          current_team_id: localTeamId,
        },
        { onConflict: "api_player_id" }
      );
    const { data: row } = await supabase
      .from("football_players")
      .select("id")
      .eq("api_player_id", top.s.id)
      .maybeSingle();
    const footballPlayerId = (row?.id as string | undefined) ?? null;

    const sample = await getPlayerHistorySample(top.s.id);
    const status: ResolveStatus = sample > 0 ? "matched" : "matched_no_history";
    return {
      api_player_id: top.s.id,
      football_player_id: footballPlayerId,
      confidence: top.score,
      status,
      candidates_count: squad.length,
      sample_size: sample,
      matched_name: top.s.name,
      notes:
        `API squad: ${top.reason} · sample=${sample}` +
        (sample === 0
          ? " — sem stats locais ainda, rode collect:player-last5"
          : ""),
    };
  }

  return {
    api_player_id: null,
    football_player_id: null,
    confidence: top.score,
    status: "unmatched",
    candidates_count: squad.length,
    sample_size: 0,
    notes: `API squad sem match forte (top: ${top.s.name} ${top.score.toFixed(2)})`,
  };
}
