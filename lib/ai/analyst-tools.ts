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
 * Mock estável de Picks do Dia. Espelha o conteúdo do dashboard
 * /picks. Quando houver tabela de picks publicadas, esta função
 * lerá do banco. Recebe userId só para preservar a assinatura
 * "tool por usuário", embora hoje todos vejam o mesmo conteúdo.
 */
export interface DailyPick {
  id: string;
  match: string;
  league: string;
  risk: "Segura" | "Valor" | "Mega";
  odd_target: number;
  status: "Pendente" | "Em análise";
  markets: { player: string; market: string }[];
  rationale: string;
}

export interface DraftBetPayload {
  match_name: string;
  total_stake: number;
  combined_odd: number;
  tier?: "segura" | "intermediaria" | "avancada" | "mega_sena";
  legs?: Array<{
    competition: string;
    home_team: string;
    away_team: string;
    market_type: string;
    selection: string;
    odd_value: number;
  }>;
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

/**
 * Mock estável das Picks do Dia v0.1. Espelho do conteúdo de
 * /picks e do dashboard. userId reservado para evolução futura.
 */
export function getTodayPicks(_userId: string): DailyPick[] {
  void _userId;
  return [
    {
      id: "vitoria-flamengo-segura",
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
        "Roteiro manual baseado em domínio territorial esperado do Flamengo, volume ofensivo e pressão sobre a defesa do Vitória. Esta prévia ainda não usa sample histórico automatizado.",
    },
    {
      id: "vitoria-flamengo-valor",
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
        "Variação mais agressiva. Modelo de exemplo — não é entrada oficial publicada.",
    },
    {
      id: "vitoria-flamengo-mega",
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
        "Combinação de alta variância. Modelo de exemplo — não é entrada oficial publicada.",
    },
  ];
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
  const potentialReturn = Math.round(stake * odd * 100) / 100;
  const legs = draft.legs ?? [];
  const betType = legs.length === 1 ? "single" : legs.length > 1 ? "multiple" : "single";

  // Insere bet
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
      notes: `Aposta criada via Analista IA — ${draft.match_name}`,
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
    }));
    const { error: legsErr } = await supabase.from("bet_legs").insert(legRows);
    if (legsErr) throw new Error(`bet_legs insert: ${legsErr.message}`);
  }

  // Atualiza bankroll + log
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
      description: `Aposta via Analista IA — ${draft.match_name}`,
    });
  }

  return { bet_id: bet.id };
}
