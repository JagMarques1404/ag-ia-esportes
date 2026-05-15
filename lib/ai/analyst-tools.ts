import "@/lib/server-only-guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

// ============================================================
// Tipos públicos
// ============================================================

export interface UserBankrollSnapshot {
  current_balance: number;
  starting_balance: number;
  daily_limit_pct: number;
  max_stake_pct: number;
  staked_today: number;
  pnl_today: number;
  remaining_today: number;
  blocked_until: string | null;
}

export interface OpenBetSummary {
  id: string;
  tier: string;
  total_stake: number;
  combined_odd: number;
  potential_return: number;
  placed_at: string;
}

export interface RecentBetSummary extends OpenBetSummary {
  status: string;
  result_value: number;
  settled_at: string | null;
}

/**
 * Picks do dia normalizadas para a UI/IA. Origem agora é a tabela
 * `public_picks` (migration 009) + `public_pick_legs` (migration 010).
 * Quando o banco estiver vazio para a data, devolvemos um conjunto
 * de exemplo (`is_example=true`) para a vitrine não ficar vazia, e
 * a UI mostra banner claro.
 */
export type PickLegStatus = "pending" | "green" | "red" | "void";

export interface PickLegResult {
  id: string;
  position: number;
  player_name: string;
  market: string;
  line: number | null;
  odd: number | null;
  actual_value: string | null;
  result_status: PickLegStatus;
  result_notes: string | null;
}

export interface DailyPick {
  id: string;
  match: string;
  league: string;
  risk: "Segura" | "Valor" | "Mega";
  odd_target: number;
  status: "Pendente" | "Em análise" | "Green" | "Red" | "Void";
  markets: { player: string; market: string }[];
  /** Legs persistidas em public_pick_legs. Vazio = ainda não settled. */
  legs?: PickLegResult[];
  /** Quantos green/red/void/pending — derivado de legs[]. */
  legs_summary?: {
    total: number;
    green: number;
    red: number;
    void: number;
    pending: number;
  };
  rationale: string;
  warning?: string;
  is_example?: boolean;
  pick_date?: string;
  kickoff_at?: string | null;
  result_notes?: string | null;
}

export interface DraftBetLeg {
  competition: string;
  home_team: string;
  away_team: string;
  market_type: string;
  selection: string;
  odd_value: number;
  /** Nome do jogador isolado (ex.: "Ollie Watkins"). */
  player_name?: string | null;
  /** Linha numérica (ex.: 1.5 para "2+ chutes"). */
  line?: number | null;
  notes?: string | null;
}

export interface DraftBetPayload {
  match_name: string;
  total_stake: number;
  combined_odd: number;
  tier?: "segura" | "intermediaria" | "avancada" | "mega_sena";
  legs?: DraftBetLeg[];
  // Migration 012 — origem da aposta
  source_type?: "manual" | "text" | "image" | "ai" | "pick";
  source_text?: string | null;
  source_image_url?: string | null;
  bookmaker?: string | null;
  /** Se conhecido: retorno potencial salvo pela casa (Bet365 mostra). */
  potential_return?: number | null;
  /** FK para public_picks quando a aposta nasceu de uma pick publicada. */
  pick_id?: string | null;
  notes?: string | null;
}

export interface DraftReminderPayload {
  type: "bet_reminder";
  match_name: string;
  kickoff_at: string;
  reminder_at: string;
  message: string;
}

export interface PendingActionRow {
  id: string;
  user_id: string;
  session_id: string | null;
  action_type: string;
  payload: unknown;
  status: string;
  created_at: string;
}

// ============================================================
// Reads
// ============================================================

export async function getUserBankroll(
  userId: string
): Promise<UserBankrollSnapshot | null> {
  const supabase = getSupabaseAdmin();
  const today = new Date().toISOString().split("T")[0];

  const [{ data: br }, { data: fw }, { data: dailyBets }] = await Promise.all([
    supabase
      .from("bankroll")
      .select(
        "current_balance, starting_balance, blocked_until"
      )
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("framework_settings")
      .select("max_stake_pct, daily_limit_pct")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("bets")
      .select("total_stake, result_value, status")
      .eq("user_id", userId)
      .gte("placed_at", `${today}T00:00:00`),
  ]);

  if (!br || !fw) return null;

  const stakedToday =
    (dailyBets ?? []).reduce((acc, b) => acc + Number(b.total_stake ?? 0), 0);
  const pnlToday = (dailyBets ?? []).reduce((acc, b) => {
    if (
      b.status === "won" ||
      b.status === "lost" ||
      b.status === "cashed_out"
    ) {
      return acc + (Number(b.result_value) - Number(b.total_stake));
    }
    return acc;
  }, 0);

  const balance = Number(br.current_balance) || 0;
  const dailyLimitPct = Number(fw.daily_limit_pct) || 12;
  const dailyLimit = balance * (dailyLimitPct / 100);

  return {
    current_balance: balance,
    starting_balance: Number(br.starting_balance) || 0,
    daily_limit_pct: dailyLimitPct,
    max_stake_pct: Number(fw.max_stake_pct) || 5,
    staked_today: stakedToday,
    pnl_today: pnlToday,
    remaining_today: Math.max(0, dailyLimit - stakedToday),
    blocked_until: br.blocked_until ?? null,
  };
}

export async function getOpenBets(
  userId: string
): Promise<OpenBetSummary[]> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("bets")
    .select("id, tier, total_stake, combined_odd, potential_return, placed_at")
    .eq("user_id", userId)
    .eq("status", "open")
    .order("placed_at", { ascending: false });
  return (data ?? []) as OpenBetSummary[];
}

export async function getRecentBetHistory(
  userId: string,
  limit = 10
): Promise<RecentBetSummary[]> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("bets")
    .select(
      "id, tier, total_stake, combined_odd, potential_return, status, result_value, placed_at, settled_at"
    )
    .eq("user_id", userId)
    .order("placed_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as RecentBetSummary[];
}

// ============================================================
// Picks (public_picks) — leitura real + fallback exemplo
// ============================================================

interface PublicPickRow {
  id: string;
  pick_date: string;
  title: string;
  match_name: string;
  league_name: string | null;
  api_fixture_id: number | null;
  kickoff_at: string | null;
  risk_level: "safe" | "value" | "mega";
  status: "draft" | "published" | "green" | "red" | "void";
  odd_target: number | null;
  confidence: number | null;
  rationale: string | null;
  warning: string | null;
  markets: unknown;
  result_notes: string | null;
  created_at: string;
  updated_at: string;
}

const RISK_LABEL: Record<PublicPickRow["risk_level"], DailyPick["risk"]> = {
  safe: "Segura",
  value: "Valor",
  mega: "Mega",
};

const STATUS_LABEL: Record<PublicPickRow["status"], DailyPick["status"]> = {
  draft: "Em análise",
  published: "Pendente",
  green: "Green",
  red: "Red",
  void: "Void",
};

function todayString(): string {
  return new Date().toISOString().split("T")[0];
}

function rowToDailyPick(row: PublicPickRow): DailyPick {
  const markets = Array.isArray(row.markets)
    ? (row.markets as Array<{ player?: string; market?: string }>).map((m) => ({
        player: String(m.player ?? "?"),
        market: String(m.market ?? "?"),
      }))
    : [];
  return {
    id: row.id,
    match: row.match_name,
    league: row.league_name ?? "?",
    risk: RISK_LABEL[row.risk_level],
    odd_target: Number(row.odd_target ?? 0) || 0,
    status: STATUS_LABEL[row.status],
    markets,
    rationale: row.rationale ?? row.title,
    warning: row.warning ?? undefined,
    is_example: false,
    pick_date: row.pick_date,
    kickoff_at: row.kickoff_at,
    result_notes: row.result_notes,
  };
}

// ============================================================
// public_pick_legs (resultado por perna)
// ============================================================

interface PickLegRow {
  id: string;
  pick_id: string;
  position: number;
  player_name: string;
  market: string;
  line: number | null;
  odd: number | null;
  actual_value: string | null;
  result_status: PickLegStatus;
  result_notes: string | null;
}

function rowToLegResult(row: PickLegRow): PickLegResult {
  return {
    id: row.id,
    position: Number(row.position ?? 0),
    player_name: row.player_name,
    market: row.market,
    line: row.line == null ? null : Number(row.line),
    odd: row.odd == null ? null : Number(row.odd),
    actual_value: row.actual_value,
    result_status: row.result_status,
    result_notes: row.result_notes,
  };
}

function summarize(legs: PickLegResult[]): DailyPick["legs_summary"] {
  return {
    total: legs.length,
    green: legs.filter((l) => l.result_status === "green").length,
    red: legs.filter((l) => l.result_status === "red").length,
    void: legs.filter((l) => l.result_status === "void").length,
    pending: legs.filter((l) => l.result_status === "pending").length,
  };
}

export async function getPickLegs(pickId: string): Promise<PickLegResult[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("public_pick_legs")
    .select(
      "id, pick_id, position, player_name, market, line, odd, actual_value, result_status, result_notes"
    )
    .eq("pick_id", pickId)
    .order("position", { ascending: true });
  if (error) {
    console.warn(`[getPickLegs] ${error.message}`);
    return [];
  }
  return ((data ?? []) as PickLegRow[]).map(rowToLegResult);
}

export async function getPickLegsForPicks(
  pickIds: string[]
): Promise<Map<string, PickLegResult[]>> {
  const map = new Map<string, PickLegResult[]>();
  if (pickIds.length === 0) return map;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("public_pick_legs")
    .select(
      "id, pick_id, position, player_name, market, line, odd, actual_value, result_status, result_notes"
    )
    .in("pick_id", pickIds)
    .order("pick_id", { ascending: true })
    .order("position", { ascending: true });
  if (error) {
    console.warn(`[getPickLegsForPicks] ${error.message}`);
    return map;
  }
  for (const r of (data ?? []) as PickLegRow[]) {
    const arr = map.get(r.pick_id) ?? [];
    arr.push(rowToLegResult(r));
    map.set(r.pick_id, arr);
  }
  return map;
}

/**
 * Anexa legs+summary a uma lista de picks. Pula picks com is_example.
 */
async function attachLegs(picks: DailyPick[]): Promise<DailyPick[]> {
  const realIds = picks.filter((p) => !p.is_example).map((p) => p.id);
  if (realIds.length === 0) return picks;
  const map = await getPickLegsForPicks(realIds);
  return picks.map((p) => {
    if (p.is_example) return p;
    const legs = map.get(p.id) ?? [];
    return {
      ...p,
      legs,
      legs_summary: legs.length > 0 ? summarize(legs) : undefined,
    };
  });
}

/** Conjunto de exemplo usado quando ainda não há picks publicadas. */
function getExamplePicks(): DailyPick[] {
  return [
    {
      id: "example-vitoria-flamengo-segura",
      match: "Vitória × Flamengo",
      league: "Copa do Brasil",
      risk: "Segura",
      odd_target: 1.9,
      status: "Pendente",
      markets: [
        { player: "Bruno Henrique", market: "+2.5 finalizações" },
        { player: "Carrascal", market: "+1.5 finalizações" },
        { player: "José Vitor", market: "+1.5 faltas cometidas" },
      ],
      rationale:
        "Roteiro manual baseado em domínio territorial esperado do Flamengo. Esta é uma pick de EXEMPLO até a publicação real do dia.",
      is_example: true,
    },
    {
      id: "example-vitoria-flamengo-valor",
      match: "Vitória × Flamengo",
      league: "Copa do Brasil",
      risk: "Valor",
      odd_target: 3.2,
      status: "Em análise",
      markets: [
        { player: "Bruno Henrique", market: "+3.5 finalizações" },
        { player: "Pedro", market: "marca a qualquer momento" },
        { player: "Allan", market: "+1.5 desarmes" },
      ],
      rationale:
        "Variação mais agressiva. Pick de EXEMPLO — não é entrada oficial publicada.",
      warning: "Modelo de exemplo — não é entrada oficial publicada.",
      is_example: true,
    },
    {
      id: "example-vitoria-flamengo-mega",
      match: "Vitória × Flamengo",
      league: "Copa do Brasil",
      risk: "Mega",
      odd_target: 8.2,
      status: "Em análise",
      markets: [
        { player: "Pedro", market: "marca primeiro gol" },
        { player: "Bruno Henrique", market: "marca a qualquer momento" },
        { player: "Léo Pereira", market: "leva cartão amarelo" },
        { player: "Carrascal", market: "+2 finalizações no gol" },
      ],
      rationale:
        "Combinação de alta variância. Pick de EXEMPLO — não é entrada oficial publicada.",
      warning:
        "Modelo de exemplo — não é entrada oficial publicada. Alta variância: não usar como stake principal.",
      is_example: true,
    },
  ];
}

/**
 * Picks de uma data específica. Retorna apenas published/green/red/void
 * (drafts ficam ocultos da vitrine).
 */
export async function getPicksByDate(date: string): Promise<DailyPick[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("public_picks")
    .select(
      "id, pick_date, title, match_name, league_name, api_fixture_id, kickoff_at, risk_level, status, odd_target, confidence, rationale, warning, markets, result_notes, created_at, updated_at"
    )
    .eq("pick_date", date)
    .in("status", ["published", "green", "red", "void"])
    .order("kickoff_at", { ascending: true, nullsFirst: false });
  if (error) {
    console.warn(`[getPicksByDate] ${error.message}`);
    return [];
  }
  const picks = ((data ?? []) as PublicPickRow[]).map(rowToDailyPick);
  return attachLegs(picks);
}

/**
 * Picks de hoje. Se nada publicado, devolve exemplos (`is_example=true`)
 * para a vitrine não ficar vazia.
 */
export async function getTodayPicks(_userId: string): Promise<DailyPick[]> {
  void _userId;
  const real = await getPicksByDate(todayString());
  if (real.length > 0) return real;
  return getExamplePicks();
}

export interface PickHistoryFilters {
  status?: ("green" | "red" | "void")[];
  riskLevel?: ("safe" | "value" | "mega")[];
  /** Data mínima inclusive (YYYY-MM-DD). */
  fromDate?: string;
  /** Data máxima inclusive (YYYY-MM-DD). */
  toDate?: string;
  limit?: number;
}

export interface PickHistoryItem extends DailyPick {
  status: "Green" | "Red" | "Void";
}

/**
 * Histórico de picks resolvidas. Por padrão, últimas 50.
 */
export async function getPickHistory(
  filters: PickHistoryFilters = {}
): Promise<PickHistoryItem[]> {
  const supabase = getSupabaseAdmin();
  const limit = filters.limit ?? 50;
  let query = supabase
    .from("public_picks")
    .select(
      "id, pick_date, title, match_name, league_name, api_fixture_id, kickoff_at, risk_level, status, odd_target, confidence, rationale, warning, markets, result_notes, created_at, updated_at"
    )
    .order("pick_date", { ascending: false })
    .order("kickoff_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (filters.status && filters.status.length > 0) {
    query = query.in("status", filters.status);
  } else {
    query = query.in("status", ["green", "red", "void"]);
  }
  if (filters.riskLevel && filters.riskLevel.length > 0) {
    query = query.in("risk_level", filters.riskLevel);
  }
  if (filters.fromDate) query = query.gte("pick_date", filters.fromDate);
  if (filters.toDate) query = query.lte("pick_date", filters.toDate);

  const { data, error } = await query;
  if (error) {
    console.warn(`[getPickHistory] ${error.message}`);
    return [];
  }
  const base = ((data ?? []) as PublicPickRow[])
    .map(rowToDailyPick)
    .filter((p): p is PickHistoryItem =>
      ["Green", "Red", "Void"].includes(p.status)
    );
  const enriched = await attachLegs(base);
  return enriched as PickHistoryItem[];
}

// ============================================================
// Writes — sempre via ai_pending_actions (nunca executa direto)
// ============================================================

export async function createBetDraft(
  userId: string,
  sessionId: string | null,
  payload: DraftBetPayload
): Promise<PendingActionRow> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("ai_pending_actions")
    .insert({
      user_id: userId,
      session_id: sessionId,
      action_type: "create_bet",
      payload,
      status: "pending",
    })
    .select("*")
    .single();
  if (error) throw new Error(`createBetDraft: ${error.message}`);
  return data as PendingActionRow;
}

export async function createReminderDraft(
  userId: string,
  sessionId: string | null,
  payload: DraftReminderPayload
): Promise<PendingActionRow> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("ai_pending_actions")
    .insert({
      user_id: userId,
      session_id: sessionId,
      action_type: "create_reminder",
      payload,
      status: "pending",
    })
    .select("*")
    .single();
  if (error) throw new Error(`createReminderDraft: ${error.message}`);
  return data as PendingActionRow;
}

// ============================================================
// Confirmação / Execução
// ============================================================

export interface ConfirmActionResult {
  ok: boolean;
  status: "executed" | "failed" | "cancelled";
  message: string;
  result?: unknown;
}

/**
 * Lê a ação pendente, valida que pertence ao usuário, executa de
 * acordo com o action_type e atualiza status para 'executed' (ou
 * 'failed' com error_message).
 */
export async function confirmPendingAction(
  userId: string,
  actionId: string
): Promise<ConfirmActionResult> {
  const supabase = getSupabaseAdmin();

  const { data: row, error: rErr } = await supabase
    .from("ai_pending_actions")
    .select("*")
    .eq("id", actionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (rErr) throw new Error(`confirmPendingAction (read): ${rErr.message}`);
  if (!row) {
    return {
      ok: false,
      status: "failed",
      message: "Ação não encontrada ou não pertence ao usuário.",
    };
  }
  if (row.status !== "pending") {
    return {
      ok: false,
      status: row.status as ConfirmActionResult["status"],
      message: `Ação já está em status '${row.status}'.`,
    };
  }

  try {
    let resultPayload: unknown = null;

    if (row.action_type === "create_bet") {
      resultPayload = await executeCreateBet(userId, row.payload as DraftBetPayload);
    } else if (row.action_type === "create_reminder") {
      // Sem tabela de reminders ainda — apenas marca como executed,
      // o payload fica para um job futuro consumir.
      resultPayload = { stored_only: true };
    } else {
      throw new Error(`action_type não suportado: ${row.action_type}`);
    }

    await supabase
      .from("ai_pending_actions")
      .update({
        status: "executed",
        executed_at: new Date().toISOString(),
        result: resultPayload as object | null,
      })
      .eq("id", actionId);

    return {
      ok: true,
      status: "executed",
      message: "Ação executada com sucesso.",
      result: resultPayload,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from("ai_pending_actions")
      .update({ status: "failed", error_message: message })
      .eq("id", actionId);
    return { ok: false, status: "failed", message };
  }
}

export async function cancelPendingAction(
  userId: string,
  actionId: string
): Promise<ConfirmActionResult> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("ai_pending_actions")
    .update({ status: "cancelled" })
    .eq("id", actionId)
    .eq("user_id", userId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`cancelPendingAction: ${error.message}`);
  if (!data) {
    return {
      ok: false,
      status: "cancelled",
      message: "Nada a cancelar (ação não pendente ou não pertence ao usuário).",
    };
  }
  return { ok: true, status: "cancelled", message: "Ação cancelada." };
}

// ============================================================
// Executor de create_bet
//   reusa a lógica de /bets/new: INSERT bets + bet_legs +
//   UPDATE bankroll + INSERT bankroll_log type='bet_placed'.
// ============================================================

async function executeCreateBet(
  userId: string,
  draft: DraftBetPayload
): Promise<{ bet_id: string }> {
  const supabase = getSupabaseAdmin();

  // Validações mínimas
  const stake = Number(draft.total_stake);
  const odd = Number(draft.combined_odd);
  if (!Number.isFinite(stake) || stake <= 0) {
    throw new Error("total_stake inválido.");
  }
  if (!Number.isFinite(odd) || odd < 1.01) {
    throw new Error("combined_odd inválido.");
  }
  const tier = draft.tier ?? "segura";
  const potentialReturn =
    draft.potential_return != null && draft.potential_return > 0
      ? Number(draft.potential_return)
      : Math.round(stake * odd * 100) / 100;
  const legs = draft.legs ?? [];
  const betType = legs.length === 1 ? "single" : legs.length > 1 ? "multiple" : "single";
  const sourceType = draft.source_type ?? "ai";

  // Insere bet — inclui colunas da migration 012 quando presentes.
  const { data: bet, error: betErr } = await supabase
    .from("bets")
    .insert({
      user_id: userId,
      bet_type: betType,
      tier,
      total_stake: stake,
      combined_odd: odd,
      potential_return: potentialReturn,
      status: "open",
      followed_framework: true,
      bookmaker: draft.bookmaker ?? null,
      notes:
        draft.notes ??
        `Aposta criada via Analista IA — ${draft.match_name}`,
      source_type: sourceType,
      source_text: draft.source_text ?? null,
      source_image_url: draft.source_image_url ?? null,
      match_name: draft.match_name,
      pick_id: draft.pick_id ?? null,
    })
    .select("id")
    .single();
  if (betErr || !bet) throw new Error(`bet insert: ${betErr?.message}`);

  // Insere legs (se houver)
  if (legs.length > 0) {
    const legRows = legs.map((l, i) => ({
      bet_id: bet.id,
      competition: l.competition,
      home_team: l.home_team,
      away_team: l.away_team,
      market_type: l.market_type,
      selection: l.selection,
      odd_value: l.odd_value,
      position: i + 1,
      // Migration 012
      player_name: l.player_name ?? null,
      line: l.line ?? null,
      notes: l.notes ?? null,
    }));
    const { error: legsErr } = await supabase.from("bet_legs").insert(legRows);
    if (legsErr) throw new Error(`bet_legs insert: ${legsErr.message}`);
  }

  // Atualiza bankroll + log (debita stake; bet_placed = -stake)
  const { data: br } = await supabase
    .from("bankroll")
    .select("current_balance, total_staked")
    .eq("user_id", userId)
    .maybeSingle();
  if (br) {
    const newBalance = Number(br.current_balance) - stake;
    const newTotalStaked = Number(br.total_staked) + stake;
    await supabase
      .from("bankroll")
      .update({
        current_balance: newBalance,
        total_staked: newTotalStaked,
      })
      .eq("user_id", userId);
    await supabase.from("bankroll_log").insert({
      user_id: userId,
      type: "bet_placed",
      amount: -stake,
      balance_after: newBalance,
      reference_id: bet.id,
      description: `Stake aposta: ${draft.match_name}${draft.bookmaker ? ` (${draft.bookmaker})` : ""}`,
    });
  }

  return { bet_id: bet.id };
}
