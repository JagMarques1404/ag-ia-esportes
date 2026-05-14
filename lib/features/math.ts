// Utilitários numéricos. Todos defensivos contra NaN/Infinity.

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function safeDivide(
  numerator: number,
  denominator: number,
  fallback = 0
): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) {
    return fallback;
  }
  if (denominator === 0) return fallback;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : fallback;
}

export function roundDecimal(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export function probabilityToFairOdd(probability: number): number {
  if (!Number.isFinite(probability)) return 0;
  if (probability <= 0 || probability >= 1) return 0;
  return roundDecimal(1 / probability, 2);
}

export function normalizeRate(value: number): number {
  return clamp(value, 0, 1);
}

export interface WeightedItem {
  value: number;
  weight: number;
}

export function weightedAverage(items: WeightedItem[]): number {
  let sum = 0;
  let totalWeight = 0;
  for (const it of items) {
    if (!Number.isFinite(it.value) || !Number.isFinite(it.weight)) continue;
    if (it.weight <= 0) continue;
    sum += it.value * it.weight;
    totalWeight += it.weight;
  }
  return safeDivide(sum, totalWeight, 0);
}

/**
 * Probabilidade Poisson de pelo menos `k` eventos quando lambda é a
 * média esperada. Usado para over X.5 gols.
 */
export function poissonAtLeast(lambda: number, k: number): number {
  if (!Number.isFinite(lambda) || lambda <= 0) return 0;
  if (k <= 0) return 1;
  // P(X >= k) = 1 - sum_{i=0..k-1} e^-lambda * lambda^i / i!
  let cumulative = 0;
  let term = Math.exp(-lambda); // i = 0
  cumulative += term;
  for (let i = 1; i < k; i++) {
    term = (term * lambda) / i;
    cumulative += term;
  }
  return clamp(1 - cumulative, 0, 1);
}
