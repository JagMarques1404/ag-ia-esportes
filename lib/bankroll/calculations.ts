import "@/lib/server-only-guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Cálculos de banca derivados de `bankroll` + `bankroll_log`.
 *
 * `bankroll` mantém saldo cacheado (current_balance, total_staked, etc.)
 * para leitura rápida no dashboard. Já é atualizado in-line nas escritas
 * de aposta / settlement. Este módulo expõe um snapshot derivado dessas
 * tabelas, útil quando precisamos validar consistência ou alimentar a IA
 * com a foto exata da banca em um momento.
 *
 * IMPORTANTE: este módulo NÃO grava nada. Apenas lê.
 */

export interface BankrollSnapshot {
  user_id: string;
  starting_balance: number;
  current_balance: number;

  total_deposited: number;
  total_withdrawn: number;
  total_staked: number;        // Σ stakes de apostas registradas (lifetime)
  total_returned: number;      // Σ retornos recebidos (lifetime)
  realized_profit: number;     // total_returned - total_staked - perdas

  /** Stake travada em apostas com status 'open' ou 'partial'. */
  open_exposure: number;

  /** current_balance - open_exposure (NÃO desce abaixo de 0). */
  available_balance: number;

  /** ROI (%) baseado em starting_balance. null se starting=0. */
  roi_pct: number | null;
}

/**
 * Snapshot da banca a partir de `bankroll` + apostas abertas.
 *
 * Usa o snapshot cacheado de `bankroll` para os agregados pesados.
 * Soma a exposição aberta lendo `bets` com status open/partial.
 */
export async function getBankrollSnapshot(
  userId: string
): Promise<BankrollSnapshot | null> {
  const supabase = getSupabaseAdmin();

  const [{ data: br, error: brErr }, { data: openBets, error: oErr }] =
    await Promise.all([
      supabase
        .from("bankroll")
        .select(
          "current_balance, starting_balance, total_deposited, total_withdrawn, total_staked, total_returned"
        )
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("bets")
        .select("total_stake")
        .eq("user_id", userId)
        .in("status", ["open", "partial"]),
    ]);
  if (brErr) throw new Error(`getBankrollSnapshot (bankroll): ${brErr.message}`);
  if (oErr) throw new Error(`getBankrollSnapshot (bets): ${oErr.message}`);
  if (!br) return null;

  const startingBalance = Number(br.starting_balance) || 0;
  const currentBalance = Number(br.current_balance) || 0;
  const totalDeposited = Number(br.total_deposited) || 0;
  const totalWithdrawn = Number(br.total_withdrawn) || 0;
  const totalStaked = Number(br.total_staked) || 0;
  const totalReturned = Number(br.total_returned) || 0;

  const openExposure = (openBets ?? []).reduce(
    (acc, b) => acc + (Number(b.total_stake) || 0),
    0
  );

  // Realized profit = retorno - stake (não inclui exposição aberta).
  const realizedProfit = totalReturned - (totalStaked - openExposure);

  // Disponível = saldo - apostas abertas (já saíram do current_balance,
  // mas mantemos o cálculo defensivo).
  const availableBalance = Math.max(0, currentBalance);

  const roiPct =
    startingBalance > 0
      ? Number(((realizedProfit / startingBalance) * 100).toFixed(2))
      : null;

  return {
    user_id: userId,
    starting_balance: startingBalance,
    current_balance: currentBalance,
    total_deposited: totalDeposited,
    total_withdrawn: totalWithdrawn,
    total_staked: totalStaked,
    total_returned: totalReturned,
    realized_profit: Number(realizedProfit.toFixed(2)),
    open_exposure: Number(openExposure.toFixed(2)),
    available_balance: Number(availableBalance.toFixed(2)),
    roi_pct: roiPct,
  };
}

/**
 * Recálculo bruto a partir do `bankroll_log` — útil para auditoria
 * ou para reconstruir o snapshot caso o cache fique inconsistente.
 *
 * NÃO grava de volta. Apenas devolve o que SERIA o saldo.
 */
export interface BankrollLogReplay {
  derived_balance: number;
  derived_total_deposited: number;
  derived_total_withdrawn: number;
  derived_total_staked: number;
  derived_total_returned: number;
  /** Diferença entre cache (`bankroll.current_balance`) e log replay. */
  drift_vs_cache: number | null;
  log_entries: number;
}

export async function replayBankrollLog(
  userId: string
): Promise<BankrollLogReplay> {
  const supabase = getSupabaseAdmin();
  const [{ data: log }, { data: br }] = await Promise.all([
    supabase
      .from("bankroll_log")
      .select("type, amount")
      .eq("user_id", userId),
    supabase
      .from("bankroll")
      .select("current_balance, starting_balance")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  let depo = 0;
  let withdr = 0;
  let staked = 0;
  let returned = 0;
  let balance = Number(br?.starting_balance) || 0;

  for (const r of log ?? []) {
    const amt = Number(r.amount) || 0;
    balance += amt;
    switch (r.type) {
      case "deposit":
        depo += amt;
        break;
      case "withdraw":
        withdr += Math.abs(amt);
        break;
      case "bet_placed":
        staked += Math.abs(amt);
        break;
      case "bet_win":
        returned += amt;
        break;
      case "bet_void":
        // bet_void devolve stake — entra no balance via amount positivo
        // mas NÃO conta como returned (não é lucro).
        returned += 0;
        break;
      case "bet_loss":
      case "cashout":
      case "adjustment":
      default:
        // bet_loss tipicamente vem com amount=0 (stake já saiu em bet_placed)
        // cashout pode somar se positivo. Já contabilizado em balance.
        if (amt > 0 && r.type !== "bet_loss") returned += amt;
        break;
    }
  }

  const cacheBalance = br ? Number(br.current_balance) || 0 : null;
  const drift = cacheBalance != null ? Number((balance - cacheBalance).toFixed(2)) : null;

  return {
    derived_balance: Number(balance.toFixed(2)),
    derived_total_deposited: Number(depo.toFixed(2)),
    derived_total_withdrawn: Number(withdr.toFixed(2)),
    derived_total_staked: Number(staked.toFixed(2)),
    derived_total_returned: Number(returned.toFixed(2)),
    drift_vs_cache: drift,
    log_entries: (log ?? []).length,
  };
}
