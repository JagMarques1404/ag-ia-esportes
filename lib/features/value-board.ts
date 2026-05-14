import "@/lib/server-only-guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  calculateFixtureFeatures,
  upsertFixtureFeatures,
} from "./fixture-features";
import {
  calculateAllMarketProbabilities,
  upsertMarketProbabilities,
  type MarketProbability,
  type RiskLevel,
} from "./probability-engine";
import { clamp, roundDecimal } from "./math";

export type ValueCategory =
  | "safe"
  | "intermediate"
  | "advanced"
  | "mega"
  | "watchlist";

export interface DailyValueBoardRow {
  date: string;
  fixture_id: string;
  api_fixture_id: number;
  league_name: string | null;
  home_team_name: string | null;
  away_team_name: string | null;
  market_key: string;
  selection: string;
  probability: number;
  fair_odd: number | null;
  confidence_score: number;
  data_quality_score: number;
  risk_level: RiskLevel;
  rank_score: number;
  category: ValueCategory;
  reason: string;
}

export interface BuildDailyValueBoardResult {
  date: string;
  fixtures_processed: number;
  fixtures_failed: number;
  probabilities_generated: number;
  board_rows_inserted: number;
  avg_data_quality: number;
  failures: { api_fixture_id: number; error: string }[];
  category_counts: Record<ValueCategory, number>;
}

// ============================================================
// Ranking + categorização
// ============================================================

/**
 * rank_score = 0.5 * probability + 0.3 * confidence + 0.2 * data_quality.
 * Tudo em [0,1]. Quanto maior, melhor o pick segundo o modelo v0.1.
 */
export function rankMarketProbability(
  probability: number,
  confidence: number,
  dataQuality: number
): number {
  return roundDecimal(
    clamp(0.5 * probability + 0.3 * confidence + 0.2 * dataQuality, 0, 1),
    4
  );
}

export function categorizePick(
  probability: number,
  confidence: number,
  dataQuality: number
): ValueCategory {
  if (probability >= 0.72 && confidence >= 0.65 && dataQuality >= 0.6) {
    return "safe";
  }
  if (probability >= 0.62 && confidence >= 0.55) {
    return "intermediate";
  }
  if (probability >= 0.52 && confidence >= 0.45) {
    return "advanced";
  }
  if (probability < 0.4 && dataQuality < 0.5) {
    // Sinal frágil — fica em watchlist
    return "watchlist";
  }
  return "watchlist";
}

function buildReason(p: MarketProbability): string {
  return `${p.market_label}: prob=${p.probability.toFixed(3)}, conf=${p.confidence_score.toFixed(2)}, dq=${p.data_quality_score.toFixed(2)}`;
}

// ============================================================
// Orquestração diária
// ============================================================

export async function buildDailyValueBoard(
  date: string
): Promise<BuildDailyValueBoardResult> {
  const supabase = getSupabaseAdmin();

  const { data: fixtures, error: fxErr } = await supabase
    .from("football_fixtures")
    .select(
      "id, api_fixture_id, date, league_name, home_team_name, away_team_name"
    )
    .eq("date", date)
    .order("kickoff_at", { ascending: true });
  if (fxErr) {
    throw new Error(`buildDailyValueBoard: ${fxErr.message}`);
  }

  const failures: { api_fixture_id: number; error: string }[] = [];
  const allBoardRows: DailyValueBoardRow[] = [];
  let probabilitiesGenerated = 0;
  let dqSum = 0;
  let dqCount = 0;
  const categoryCounts: Record<ValueCategory, number> = {
    safe: 0,
    intermediate: 0,
    advanced: 0,
    mega: 0,
    watchlist: 0,
  };

  for (const fx of fixtures ?? []) {
    try {
      const features = await calculateFixtureFeatures(fx.id);
      await upsertFixtureFeatures(features);

      const probabilities = calculateAllMarketProbabilities(features);
      await upsertMarketProbabilities(probabilities);
      probabilitiesGenerated += probabilities.length;
      dqSum += features.data_quality_score;
      dqCount++;

      for (const p of probabilities) {
        const category = categorizePick(
          p.probability,
          p.confidence_score,
          p.data_quality_score
        );
        const rank = rankMarketProbability(
          p.probability,
          p.confidence_score,
          p.data_quality_score
        );
        categoryCounts[category]++;
        allBoardRows.push({
          date,
          fixture_id: fx.id,
          api_fixture_id: fx.api_fixture_id,
          league_name: fx.league_name,
          home_team_name: fx.home_team_name,
          away_team_name: fx.away_team_name,
          market_key: p.market_key,
          selection: p.selection,
          probability: p.probability,
          fair_odd: p.fair_odd,
          confidence_score: p.confidence_score,
          data_quality_score: p.data_quality_score,
          risk_level: p.risk_level,
          rank_score: rank,
          category,
          reason: buildReason(p),
        });
      }
    } catch (err) {
      failures.push({
        api_fixture_id: fx.api_fixture_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Refresh do board do dia (idempotente).
  await supabase.from("football_daily_value_board").delete().eq("date", date);

  if (allBoardRows.length > 0) {
    const { error: insErr } = await supabase
      .from("football_daily_value_board")
      .insert(
        allBoardRows.map((r) => ({
          ...r,
          updated_at: new Date().toISOString(),
        }))
      );
    if (insErr) {
      throw new Error(
        `buildDailyValueBoard (insert board): ${insErr.message}`
      );
    }
  }

  return {
    date,
    fixtures_processed: (fixtures?.length ?? 0) - failures.length,
    fixtures_failed: failures.length,
    probabilities_generated: probabilitiesGenerated,
    board_rows_inserted: allBoardRows.length,
    avg_data_quality: dqCount > 0 ? roundDecimal(dqSum / dqCount, 3) : 0,
    failures,
    category_counts: categoryCounts,
  };
}

export async function getDailyValueBoard(
  date: string
): Promise<DailyValueBoardRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("football_daily_value_board")
    .select("*")
    .eq("date", date)
    .order("rank_score", { ascending: false });
  if (error) {
    throw new Error(`getDailyValueBoard: ${error.message}`);
  }
  return (data ?? []) as DailyValueBoardRow[];
}
