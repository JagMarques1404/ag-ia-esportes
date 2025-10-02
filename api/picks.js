// api/picks.js  (ESM - compatível com @supabase/supabase-js v2)
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function toTodayRangeUTC() {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function formatRows(recs = []) {
  return recs.map((p) => ({
    fixture_id: p.fixture_ext_id ?? p.fixture_id ?? p.id,
    homeTeam: p.home ?? p.team_home ?? '',
    awayTeam: p.away ?? p.team_away ?? '',
    league: p.league ?? '',
    kickoff: p.kickoff_utc ?? p.kickoff ?? null,
    market: p.market ?? 'goals_over_2_5',
    selection: p.selection ?? 'over',
    prob: Number(p.prob ?? p.probability ?? 0),
    fairOdd: Number(p.fair_odd ?? 0),
    marketOdd: Number(p.odd_mkt ?? p.best_market_odd ?? 0),
    edgePct: Number(p.edge_pct ?? p.edge_percentage ?? 0),
    confidence:
      (p.edge_pct ?? p.edge_percentage ?? 0) >= 20
        ? 'Forte'
        : (p.edge_pct ?? p.edge_percentage ?? 0) >= 10
        ? 'Moderada'
        : 'Observação',
  }));
}

export default async function handler(_req, res) {
  try {
    const { start, end } = toTodayRangeUTC();

    // 1) tenta filtrar por kickoff_utc (preferido)
    let { data: recs, error } = await supabase
      .from('recommendations')
      .select('*')
      .gte('kickoff_utc', start)
      .lt('kickoff_utc', end)
      .order('edge_pct', { ascending: false })
      .limit(20);

    if (error) throw new Error(error.message);

    // 2) fallback: created_at (se não tiver kickoff_utc)
    if (!Array.isArray(recs) || recs.length === 0) {
      const r2 = await supabase
        .from('recommendations')
        .select('*')
        .gte('created_at', start)
        .lt('created_at', end)
        .order('edge_pct', { ascending: false })
        .limit(20);
      if (r2.error) throw new Error(r2.error.message);
      recs = r2.data ?? [];
    }

    const formatted = formatRows(recs);

    return res.status(200).json({
      success: true,
      count: formatted.length,
      data: formatted,   // <- front aceita "data"
      picks: formatted,  // <- e também "picks"
    });
  } catch (e) {
    console.error('[api/picks] Fatal:', e);
    return res.status(200).json({ success: false, data: [], picks: [], error: e.message });
  }
}
