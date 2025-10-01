// api/picks.js  (Node Serverless Function - Vercel)
const { createClient } = require('@supabase/supabase-js');

// Use variáveis de BACKEND, não VITE_*
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (_req, res) => {
  try {
    // janela do dia UTC (00:00 → 23:59)
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 1);

    // busca recomendações do dia, ordenadas por edge
    const { data: recs, error } = await supabase
      .from('recommendations')
      .select('*')
      .gte('kickoff_utc', start.toISOString())
      .lt('kickoff_utc', end.toISOString())
      .order('edge_pct', { ascending: false })
      .limit(20);

    if (error) {
      console.error('[api/picks] Supabase error:', error.message);
      return res.status(200).json({ success: false, data: [], picks: [], error: error.message });
    }

    const safe = Array.isArray(recs) ? recs : [];

    const formatted = safe.map(p => ({
      fixture_id: p.fixture_ext_id,
      homeTeam: p.home,
      awayTeam: p.away,
      league: p.league,
      kickoff: p.kickoff_utc,
      market: p.market,          // ex.: "goals_over_2_5"
      selection: p.selection,    // ex.: "over"
      prob: Number(p.prob),                      // 0..1
      fairOdd: Number(p.fair_odd),               // 1/prob
      marketOdd: Number(p.odd_mkt),              // melhor odd (proxy)
      edgePct: Number(p.edge_pct),               // %
      confidence: p.edge_pct >= 20 ? 'Forte' : p.edge_pct >= 10 ? 'Moderada' : 'Observação'
    }));

    // ✅ compatibilidade: respondemos com "data" E "picks"
    return res.status(200).json({
      success: true,
      count: formatted.length,
      data: formatted,
      picks: formatted
    });
  } catch (e) {
    console.error('[api/picks] Fatal:', e);
    return res.status(200).json({ success: false, data: [], picks: [], error: 'Erro interno' });
  }
};
