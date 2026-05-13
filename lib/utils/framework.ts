import type { Bankroll, FrameworkSettings, Bet, FrameworkCheck } from "@/types";

/**
 * Calcula EV% de uma aposta.
 * EV% = (prob * odd - 1) * 100
 */
export function calculateEV(probabilityPct: number, odd: number): number {
  const prob = probabilityPct / 100;
  return Math.round((prob * odd - 1) * 100 * 100) / 100;
}

/**
 * Odd justa = 1 / probabilidade
 */
export function calculateFairOdd(probabilityPct: number): number {
  if (probabilityPct <= 0 || probabilityPct >= 100) return 0;
  return Math.round((100 / probabilityPct) * 100) / 100;
}

/**
 * Kelly Criterion fracionário (1/4 Kelly recomendado)
 */
export function calculateKelly(probabilityPct: number, odd: number, fraction = 0.25): number {
  const prob = probabilityPct / 100;
  const kellyPct = ((odd * prob) - 1) / (odd - 1);
  return Math.max(0, kellyPct * fraction);
}

/**
 * Calcula probabilidade combinada (multiplicação simples; correlação em fases futuras)
 */
export function calculateCombinedProb(probabilitiesPct: number[]): number {
  const product = probabilitiesPct.reduce((acc, p) => acc * (p / 100), 1);
  return Math.round(product * 100 * 100) / 100;
}

/**
 * Combina odds multiplicando
 */
export function calculateCombinedOdd(odds: number[]): number {
  const product = odds.reduce((acc, o) => acc * o, 1);
  return Math.round(product * 100) / 100;
}

/**
 * Valida se uma aposta cabe no framework do usuário.
 */
export function checkFramework(
  bankroll: Bankroll,
  settings: FrameworkSettings,
  proposedStake: number,
  todayStats: { staked: number; pnl: number; bets_count: number }
): FrameworkCheck {
  const warnings: string[] = [];
  const balance = bankroll.current_balance;
  const maxStakePerBet = balance * (settings.max_stake_pct / 100);
  const maxStakeDaily = balance * (settings.daily_limit_pct / 100);
  const stopLossValue = -1 * balance * (settings.stop_loss_pct / 100);
  const stopWinValue = balance * (settings.stop_win_pct / 100);
  const stakeRemaining = maxStakeDaily - todayStats.staked;
  const betsRemaining = settings.max_bets_per_day - todayStats.bets_count;

  // Bloqueio temporário
  if (bankroll.blocked_until && new Date(bankroll.blocked_until) > new Date()) {
    return {
      status: "red",
      can_bet: false,
      reason: `Bloqueado até ${bankroll.blocked_until}. Motivo: ${bankroll.block_reason}`,
      warnings,
      stake_remaining_today: 0,
      bets_remaining_today: 0,
    };
  }

  // Modo pausa
  if (settings.protection_mode === "paused") {
    return {
      status: "red",
      can_bet: false,
      reason: "Modo Pausa ativado. Reative em Configurações.",
      warnings,
      stake_remaining_today: 0,
      bets_remaining_today: 0,
    };
  }

  // Stop-loss já disparado
  if (todayStats.pnl <= stopLossValue) {
    return {
      status: "red",
      can_bet: false,
      reason: `Stop-loss diário atingido (${settings.stop_loss_pct}%). Bloqueado por 24h.`,
      warnings,
      stake_remaining_today: 0,
      bets_remaining_today: 0,
    };
  }

  // Stake acima do máximo por aposta
  if (proposedStake > maxStakePerBet) {
    return {
      status: "red",
      can_bet: false,
      reason: `Stake R$${proposedStake.toFixed(2)} acima do limite de ${settings.max_stake_pct}% (R$${maxStakePerBet.toFixed(2)}).`,
      warnings,
      stake_remaining_today: stakeRemaining,
      bets_remaining_today: betsRemaining,
    };
  }

  // Limite diário ultrapassaria
  if (todayStats.staked + proposedStake > maxStakeDaily) {
    return {
      status: "red",
      can_bet: false,
      reason: `Esta aposta ultrapassa o limite diário de ${settings.daily_limit_pct}% (R$${maxStakeDaily.toFixed(2)}). Restante hoje: R$${stakeRemaining.toFixed(2)}.`,
      warnings,
      stake_remaining_today: stakeRemaining,
      bets_remaining_today: betsRemaining,
    };
  }

  // Máximo de apostas diárias
  if (todayStats.bets_count >= settings.max_bets_per_day) {
    return {
      status: "red",
      can_bet: false,
      reason: `Limite de ${settings.max_bets_per_day} apostas/dia atingido.`,
      warnings,
      stake_remaining_today: stakeRemaining,
      bets_remaining_today: 0,
    };
  }

  // Avisos amarelos (permite, mas alerta)
  if (todayStats.pnl >= stopWinValue) {
    warnings.push(`✅ Stop-win atingido (+${settings.stop_win_pct}%). Considere sacar.`);
  }
  if (proposedStake > maxStakePerBet * 0.8) {
    warnings.push(`⚠️ Stake próximo do limite máximo (${settings.max_stake_pct}%).`);
  }
  if (todayStats.staked + proposedStake > maxStakeDaily * 0.8) {
    warnings.push(`⚠️ Você atingirá 80% do limite diário com esta aposta.`);
  }
  if (bankroll.current_streak_type === "loss" && bankroll.current_streak_count >= 2) {
    warnings.push(`⚠️ Você tem ${bankroll.current_streak_count} derrotas seguidas. Considere pausar.`);
  }

  return {
    status: warnings.length > 0 ? "yellow" : "green",
    can_bet: true,
    warnings,
    stake_remaining_today: stakeRemaining,
    bets_remaining_today: betsRemaining,
  };
}

/**
 * Sugere tier baseado em probabilidade combinada
 */
export function suggestTier(probabilityPct: number): "segura" | "intermediaria" | "avancada" | "mega_sena" {
  if (probabilityPct >= 50) return "segura";
  if (probabilityPct >= 25) return "intermediaria";
  if (probabilityPct >= 8) return "avancada";
  return "mega_sena";
}
