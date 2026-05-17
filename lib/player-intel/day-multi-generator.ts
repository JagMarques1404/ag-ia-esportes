import "@/lib/server-only-guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  generateSafeMulti,
  generateValueMulti,
  generateSoloPick,
  type PickLeg,
  type GeneratedPick,
} from "./final-pick-generator";
import { evaluateFixtureReadinessForPick } from "./readiness-gate";

/**
 * Gerador "do dia" — combina legs de DIFERENTES jogos em UMA múltipla.
 * Fase E.0A.11.
 *
 *   - generateBestUpcomingSoloList    : lista solos por jogo
 *   - generateBestUpcomingMulti       : múltipla segura cross-fixture (3-5 legs)
 *   - generateBestUpcomingValueMulti  : valor cross-fixture (4-6 legs)
 *
 * Regras gerais:
 *   - SÓ jogos com kickoff_at > now (fromNow=true) ou >= fromTime
 *   - READY ou WATCHLIST forte (dq médio ≥ 0.55, with_history ≥ 5)
 *   - Máximo 1 leg por jogo na múltipla (diversificação)
 *   - Excluir jogos com sample3=0 ou dq=0
 *   - Retornar ignoredGames com motivo (auditoria)
 */

export interface UpcomingMultiOptions {
  date: string;            // YYYY-MM-DD
  /** Default true. Se false, usa fromTime. */
  fromNow?: boolean;
  /** ISO timestamp. Default Date.now(). */
  now?: string;
  /** HH:mm BR. Filtra fixtures cujo kickoff_at >= esse horário no dia. */
  fromTime?: string;
}

export interface UpcomingLeg extends PickLeg {
  api_fixture_id: number;
  match_name: string;
  league_name: string | null;
  kickoff_at: string | null;
}

export interface UpcomingMultiResult {
  legs: UpcomingLeg[];
  combined_probability: number;
  reason: string;
}

export interface UpcomingSummary {
  best_solo: { fixture: UpcomingLeg; reason: string } | null;
  safe_multi: UpcomingMultiResult | null;
  value_multi: UpcomingMultiResult | null;
  considered_fixtures: number;
  ignored_games: Array<{
    api_fixture_id: number;
    match_name: string;
    reason: string;
  }>;
}

interface FixtureRow {
  id: string;
  api_fixture_id: number;
  league_name: string | null;
  home_team_name: string | null;
  away_team_name: string | null;
  kickoff_at: string | null;
}

async function loadEligibleFixtures(
  opts: UpcomingMultiOptions
): Promise<FixtureRow[]> {
  const sb = getSupabaseAdmin();
  const date = opts.date;
  const nextDate = (() => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().split("T")[0];
  })();

  const { data: catalogIds } = await sb
    .from("football_leagues_catalog")
    .select("api_league_id")
    .eq("is_auto_pick", true);
  const autoPickIds = (catalogIds ?? [])
    .map((r) => Number(r.api_league_id))
    .filter((n) => Number.isFinite(n));

  function buildQ() {
    let q = sb
      .from("football_fixtures")
      .select(
        "id, api_fixture_id, league_name, home_team_name, away_team_name, kickoff_at"
      )
      .order("kickoff_at", { ascending: true, nullsFirst: false });
    if (autoPickIds.length > 0) q = q.in("api_league_id", autoPickIds);
    return q;
  }
  const [byDate, byKick] = await Promise.all([
    buildQ().eq("date", date),
    buildQ()
      .gte("kickoff_at", `${date}T03:00:00Z`)
      .lt("kickoff_at", `${nextDate}T03:00:00Z`),
  ]);
  const merged = new Map<number, FixtureRow>();
  for (const r of (byDate.data ?? []) as FixtureRow[])
    merged.set(r.api_fixture_id, r);
  for (const r of (byKick.data ?? []) as FixtureRow[])
    if (!merged.has(r.api_fixture_id)) merged.set(r.api_fixture_id, r);

  const all = Array.from(merged.values());
  const now = opts.now ? new Date(opts.now) : new Date();

  function passTimeFilter(fx: FixtureRow): boolean {
    if (!fx.kickoff_at) return false;
    const ko = new Date(fx.kickoff_at);
    if (opts.fromNow !== false) {
      // default: a partir de agora
      return ko > now;
    }
    if (opts.fromTime && /^\d{2}:\d{2}$/.test(opts.fromTime)) {
      // BR (UTC-3) → "HH:mm" do dia
      const cutoffBr = new Date(`${date}T${opts.fromTime}:00-03:00`);
      return ko >= cutoffBr;
    }
    return ko > now;
  }

  return all
    .filter(passTimeFilter)
    .sort((a, b) => (a.kickoff_at ?? "").localeCompare(b.kickoff_at ?? ""));
}

/**
 * Combina probabilidades multiplicativamente (independência presumida).
 */
function combinedProbability(probs: number[]): number {
  if (probs.length === 0) return 0;
  return Number(probs.reduce((a, b) => a * Math.max(0, Math.min(1, b)), 1).toFixed(4));
}

function legToUpcoming(
  leg: PickLeg,
  fx: FixtureRow,
  matchName: string
): UpcomingLeg {
  return {
    ...leg,
    api_fixture_id: fx.api_fixture_id,
    match_name: matchName,
    league_name: fx.league_name,
    kickoff_at: fx.kickoff_at,
  };
}

export async function generateBestUpcomingSoloList(
  opts: UpcomingMultiOptions
): Promise<{
  solos: Array<{ fixture: FixtureRow; pick: GeneratedPick; reason: string }>;
  ignored: UpcomingSummary["ignored_games"];
}> {
  const fixtures = await loadEligibleFixtures(opts);
  const solos: Array<{
    fixture: FixtureRow;
    pick: GeneratedPick;
    reason: string;
  }> = [];
  const ignored: UpcomingSummary["ignored_games"] = [];

  for (const fx of fixtures) {
    const matchName = `${fx.home_team_name ?? "?"} × ${fx.away_team_name ?? "?"}`;
    try {
      const gate = await evaluateFixtureReadinessForPick(fx.api_fixture_id);
      if (gate.level === "BLOCKED" || gate.avg_data_quality < 0.55) {
        ignored.push({
          api_fixture_id: fx.api_fixture_id,
          match_name: matchName,
          reason: `${gate.level} dq=${gate.avg_data_quality.toFixed(2)} hist=${gate.with_history}`,
        });
        continue;
      }
      const solo = await generateSoloPick(fx.api_fixture_id);
      if (!solo) {
        ignored.push({
          api_fixture_id: fx.api_fixture_id,
          match_name: matchName,
          reason: "sem leg que passe nos critérios solo",
        });
        continue;
      }
      solos.push({
        fixture: fx,
        pick: solo,
        reason: `gate=${gate.level}, dq=${gate.avg_data_quality.toFixed(2)}`,
      });
    } catch (err) {
      ignored.push({
        api_fixture_id: fx.api_fixture_id,
        match_name: matchName,
        reason: `erro: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  return { solos, ignored };
}

async function generateCrossFixtureMulti(
  opts: UpcomingMultiOptions,
  mode: "safe" | "value"
): Promise<{ result: UpcomingMultiResult | null; ignored: UpcomingSummary["ignored_games"]; considered: number }> {
  const fixtures = await loadEligibleFixtures(opts);
  const ignored: UpcomingSummary["ignored_games"] = [];
  // Para cada fixture, pega a MELHOR leg (top do board com critério mode)
  interface BestLeg {
    fx: FixtureRow;
    matchName: string;
    leg: PickLeg;
    score_value: number;
  }
  const bests: BestLeg[] = [];

  for (const fx of fixtures) {
    const matchName = `${fx.home_team_name ?? "?"} × ${fx.away_team_name ?? "?"}`;
    try {
      const gate = await evaluateFixtureReadinessForPick(fx.api_fixture_id);
      const minDq = mode === "safe" ? 0.65 : 0.55;
      const minHistory = mode === "safe" ? 8 : 5;
      if (gate.with_history < minHistory || gate.avg_data_quality < minDq) {
        ignored.push({
          api_fixture_id: fx.api_fixture_id,
          match_name: matchName,
          reason: `${mode}: dq=${gate.avg_data_quality.toFixed(2)} (<${minDq}) ou hist=${gate.with_history} (<${minHistory})`,
        });
        continue;
      }
      const pick =
        mode === "safe"
          ? await generateSafeMulti(fx.api_fixture_id)
          : await generateValueMulti(fx.api_fixture_id);
      if (!pick || pick.legs.length === 0) {
        ignored.push({
          api_fixture_id: fx.api_fixture_id,
          match_name: matchName,
          reason: `sem ${mode} válida (critérios mais rígidos)`,
        });
        continue;
      }
      // Top leg do pick = primeira (já ordenada por score interno)
      const top = pick.legs[0];
      bests.push({
        fx,
        matchName,
        leg: top,
        score_value:
          top.probability *
          top.data_quality_score *
          Math.min(1, top.sample_size / 5),
      });
    } catch (err) {
      ignored.push({
        api_fixture_id: fx.api_fixture_id,
        match_name: matchName,
        reason: `erro: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Ordena por score, pega até N legs (safe: 3-5; value: 4-6)
  bests.sort((a, b) => b.score_value - a.score_value);
  const cap = mode === "safe" ? 5 : 6;
  const minLegs = mode === "safe" ? 3 : 4;
  const picked = bests.slice(0, cap);
  if (picked.length < minLegs) {
    return {
      result: null,
      ignored,
      considered: fixtures.length,
    };
  }
  const legs = picked.map((b) => legToUpcoming(b.leg, b.fx, b.matchName));
  const probs = legs.map((l) => l.probability);
  const combined = combinedProbability(probs);
  const reason =
    `${legs.length} legs cross-fixture (mode=${mode}). ` +
    `Critério: prob × dq × min(1, sample/5). 1 leg por jogo. ` +
    `Combinada estimada ${(combined * 100).toFixed(1)}%.`;
  return {
    result: { legs, combined_probability: combined, reason },
    ignored,
    considered: fixtures.length,
  };
}

export async function generateBestUpcomingMulti(
  opts: UpcomingMultiOptions
): Promise<UpcomingSummary> {
  const [safe, value, soloList] = await Promise.all([
    generateCrossFixtureMulti(opts, "safe"),
    generateCrossFixtureMulti(opts, "value"),
    generateBestUpcomingSoloList(opts),
  ]);

  // Best solo: maior score de probability × dq entre todos os solos
  const allSolos = soloList.solos
    .map((s) => {
      const leg = s.pick.legs[0];
      if (!leg) return null;
      return {
        upcoming: legToUpcoming(
          leg,
          s.fixture,
          `${s.fixture.home_team_name ?? "?"} × ${s.fixture.away_team_name ?? "?"}`
        ),
        score_value: leg.probability * leg.data_quality_score,
        reason: s.reason,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort((a, b) => b.score_value - a.score_value);

  // Merge ignored (dedupe por api_fixture_id)
  const ignoredMap = new Map<number, UpcomingSummary["ignored_games"][number]>();
  for (const i of [...safe.ignored, ...value.ignored, ...soloList.ignored]) {
    if (!ignoredMap.has(i.api_fixture_id)) ignoredMap.set(i.api_fixture_id, i);
  }

  return {
    best_solo:
      allSolos.length > 0
        ? { fixture: allSolos[0].upcoming, reason: allSolos[0].reason }
        : null,
    safe_multi: safe.result,
    value_multi: value.result,
    considered_fixtures: Math.max(safe.considered, value.considered),
    ignored_games: Array.from(ignoredMap.values()),
  };
}

export async function generateBestUpcomingValueMulti(
  opts: UpcomingMultiOptions
): Promise<UpcomingMultiResult | null> {
  const r = await generateCrossFixtureMulti(opts, "value");
  return r.result;
}
