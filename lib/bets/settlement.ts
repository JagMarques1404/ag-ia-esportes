import "@/lib/server-only-guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Lógica de settlement granular por leg.
 *
 *   - `recomputeBetStatus`  : determina o status agregado a partir do
 *                              array de results das legs.
 *   - `settleLegAndMaybeBet`: aplica resultado em uma leg, recalcula o
 *                              bet e — se atingiu estado final — liquida
 *                              banca uma única vez (idempotente).
 *
 * Schema usado:
 *   bet_legs.result   : 'pending'|'won'|'lost'|'void'|'half_won'|'half_lost'
 *   bets.status       : 'open'|'won'|'lost'|'cashed_out'|'void'|'partial'
 *   bankroll_log      : sem coluna bet_id — embute [bet:ID] em description.
 *
 * Idempotência: marcador no bankroll_log.description.
 */

export type LegResult = "pending" | "won" | "lost" | "void";
export type BetTerminalStatus = "won" | "lost" | "void" | "open" | "partial";

const SETTLE_MARKER_PREFIX = "[bet:";
const SETTLE_MARKER_SUFFIX = "] Aposta liquidada";

function settledMarker(betId: string): string {
  return `${SETTLE_MARKER_PREFIX}${betId}${SETTLE_MARKER_SUFFIX}`;
}

/**
 * Decide o status agregado da aposta com base nos results das legs.
 *
 * Regras (v0):
 *   - Qualquer 'lost'                       → bet 'lost'
 *   - Qualquer 'pending'                    → bet 'open'
 *   - Todas 'void'                          → bet 'void'
 *   - Mistura 'won' + 'void' (sem outros)   → bet 'won' (v0 simplificado)
 *   - Todas 'won'                           → bet 'won'
 *
 * Não retorna 'partial' nesta versão — fica reservado para depois
 * (cashout parcial / half_won).
 */
export function recomputeBetStatus(
  results: ReadonlyArray<string | null>
): BetTerminalStatus {
  const norm = results.map((r) => (r ?? "pending") as string);
  if (norm.length === 0) return "open";
  if (norm.some((r) => r === "lost" || r === "half_lost")) return "lost";
  if (norm.some((r) => r === "pending")) return "open";
  if (norm.every((r) => r === "void")) return "void";
  // Mistura won + void → won.
  if (norm.every((r) => r === "won" || r === "half_won" || r === "void")) {
    return "won";
  }
  return "open";
}

interface BetRow {
  id: string;
  user_id: string;
  total_stake: number;
  potential_return: number;
  status: string;
  match_name: string | null;
}

/**
 * Verifica idempotência: se já existe log de liquidação para esse bet,
 * NÃO liquida de novo. Usa apenas description (sem bet_id), porque o
 * schema real do bankroll_log no usuário não tem essa coluna.
 */
async function alreadySettled(betId: string, userId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("bankroll_log")
    .select("id")
    .eq("user_id", userId)
    .ilike("description", `${settledMarker(betId)}%`)
    .limit(1);
  return (data ?? []).length > 0;
}

/**
 * Aplica liquidação na banca + log. Não é idempotente sozinha — caller
 * deve checar `alreadySettled` antes.
 *
 * Retorna o valor creditado em result_value (won=potential_return,
 * void=stake, lost=0).
 */
async function applyBankrollSettlement(
  bet: BetRow,
  finalStatus: "won" | "lost" | "void"
): Promise<{ creditedAmount: number; balanceAfter: number }> {
  const supabase = getSupabaseAdmin();

  const stake = Number(bet.total_stake) || 0;
  const potentialReturn = Number(bet.potential_return) || 0;

  const { data: br } = await supabase
    .from("bankroll")
    .select("current_balance, total_returned, current_streak_type, current_streak_count")
    .eq("user_id", bet.user_id)
    .maybeSingle();

  const currentBalance = Number(br?.current_balance) || 0;
  const totalReturned = Number(br?.total_returned) || 0;

  let credited = 0;
  let logType: "bet_win" | "bet_loss" | "bet_void";
  let humanLabel: string;

  switch (finalStatus) {
    case "won":
      credited = potentialReturn;
      logType = "bet_win";
      humanLabel = "green/won";
      break;
    case "lost":
      credited = 0;
      logType = "bet_loss";
      humanLabel = "red/lost";
      break;
    case "void":
      credited = stake;
      logType = "bet_void";
      humanLabel = "void — stake devolvida";
      break;
  }

  const newBalance = Number((currentBalance + credited).toFixed(2));

  // Atualiza bankroll cacheado quando há crédito
  if (br) {
    const newTotalReturned =
      finalStatus === "won"
        ? Number((totalReturned + credited).toFixed(2))
        : totalReturned;

    // Streak tracking simples
    const newStreakType =
      finalStatus === "won" ? "win" : finalStatus === "lost" ? "loss" : null;
    const updates: Record<string, unknown> = {
      current_balance: newBalance,
      total_returned: newTotalReturned,
    };
    if (newStreakType) {
      const sameStreak = br.current_streak_type === newStreakType;
      updates.current_streak_type = newStreakType;
      updates.current_streak_count = sameStreak
        ? (Number(br.current_streak_count) || 0) + 1
        : 1;
    }
    await supabase.from("bankroll").update(updates).eq("user_id", bet.user_id);
  }

  await supabase.from("bankroll_log").insert({
    user_id: bet.user_id,
    type: logType,
    amount: credited,
    balance_after: newBalance,
    description: `${settledMarker(bet.id)} como ${humanLabel}`,
  });

  return { creditedAmount: credited, balanceAfter: newBalance };
}

export interface SettleLegInput {
  userId: string;
  betId: string;
  legId: string;
  result: LegResult;
  actualValue?: string | null;
  notes?: string | null;
}

export interface SettleLegResult {
  bet_id: string;
  bet_status: BetTerminalStatus;
  /** True se ESTA chamada disparou a liquidação (saiu de open). */
  bet_settled_now: boolean;
  /** Valor creditado se liquidou agora. 0 se já estava liquidada ou não liquidou. */
  credited_amount: number;
  /** Saldo após (atual da bankroll). */
  balance_after: number;
  legs_summary: {
    total: number;
    won: number;
    lost: number;
    void: number;
    pending: number;
  };
}

/**
 * Marca uma leg, recalcula bet.status, liquida banca se entrou em
 * estado final. Idempotente: se a aposta já estava liquidada, apenas
 * atualiza a leg e devolve snapshot.
 */
export async function settleLegAndMaybeBet(
  input: SettleLegInput
): Promise<SettleLegResult> {
  const supabase = getSupabaseAdmin();
  const { userId, betId, legId, result, actualValue, notes } = input;

  // 1. Bet ownership + status check.
  const { data: betRow, error: bErr } = await supabase
    .from("bets")
    .select(
      "id, user_id, total_stake, potential_return, status, match_name"
    )
    .eq("id", betId)
    .eq("user_id", userId)
    .maybeSingle();
  if (bErr) throw new Error(`settleLeg (bet): ${bErr.message}`);
  if (!betRow) throw new Error("Aposta não encontrada ou não pertence a você.");
  const bet = betRow as BetRow;

  if (bet.status !== "open" && bet.status !== "partial") {
    throw new Error(
      `Aposta já está em status '${bet.status}'. Não é possível alterar legs.`
    );
  }

  // 2. Verificar que a leg pertence a esta bet.
  const { data: legCheck, error: lErr } = await supabase
    .from("bet_legs")
    .select("id")
    .eq("id", legId)
    .eq("bet_id", betId)
    .maybeSingle();
  if (lErr) throw new Error(`settleLeg (leg): ${lErr.message}`);
  if (!legCheck) throw new Error("Leg não encontrada nesta aposta.");

  // 3. UPDATE leg.
  const updates: Record<string, unknown> = { result };
  if (actualValue !== undefined) updates.actual_value = actualValue;
  if (notes !== undefined) updates.notes = notes;

  const { error: uErr } = await supabase
    .from("bet_legs")
    .update(updates)
    .eq("id", legId)
    .eq("bet_id", betId);
  if (uErr) throw new Error(`settleLeg (update): ${uErr.message}`);

  // 4. Reler todas as legs pra recalcular bet.status.
  const { data: allLegs } = await supabase
    .from("bet_legs")
    .select("result")
    .eq("bet_id", betId);
  const results = (allLegs ?? []).map((r) => (r.result as string | null) ?? "pending");

  const summary = {
    total: results.length,
    won: results.filter((r) => r === "won" || r === "half_won").length,
    lost: results.filter((r) => r === "lost" || r === "half_lost").length,
    void: results.filter((r) => r === "void").length,
    pending: results.filter((r) => r === "pending").length,
  };

  const newBetStatus = recomputeBetStatus(results);

  // 5. Persistir status do bet quando muda.
  let creditedAmount = 0;
  let settledNow = false;
  let balanceAfter = 0;

  // Lê saldo atual (para retornar mesmo quando não liquida)
  const { data: brSnap } = await supabase
    .from("bankroll")
    .select("current_balance")
    .eq("user_id", userId)
    .maybeSingle();
  balanceAfter = Number(brSnap?.current_balance) || 0;

  if (newBetStatus !== bet.status) {
    const isTerminal =
      newBetStatus === "won" ||
      newBetStatus === "lost" ||
      newBetStatus === "void";

    if (isTerminal) {
      // Idempotência: só liquida se ainda não foi liquidado.
      const already = await alreadySettled(betId, userId);
      if (!already) {
        const settle = await applyBankrollSettlement(bet, newBetStatus);
        creditedAmount = settle.creditedAmount;
        balanceAfter = settle.balanceAfter;
        settledNow = true;
      }

      const updateBet: Record<string, unknown> = {
        status: newBetStatus,
        result_value:
          newBetStatus === "won"
            ? bet.potential_return
            : newBetStatus === "void"
              ? bet.total_stake
              : 0,
        settled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await supabase
        .from("bets")
        .update(updateBet)
        .eq("id", betId)
        .eq("user_id", userId);
    } else {
      // partial / open — só atualiza status (sem settled_at)
      await supabase
        .from("bets")
        .update({ status: newBetStatus, updated_at: new Date().toISOString() })
        .eq("id", betId)
        .eq("user_id", userId);
    }
  }

  return {
    bet_id: betId,
    bet_status: newBetStatus,
    bet_settled_now: settledNow,
    credited_amount: Number(creditedAmount.toFixed(2)),
    balance_after: Number(balanceAfter.toFixed(2)),
    legs_summary: summary,
  };
}
