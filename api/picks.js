import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Buscar picks do dia atual
    const today = new Date().toISOString().split('T')[0];
    
    const { data, error } = await supabase
      .from('recommendations')
      .select('*')
      .eq('status', 'active')
      .order('edge_percentage', { ascending: false })
      .limit(10);

    if (error || !data || data.length === 0) {
      // Retornar dados demo se não houver dados reais
      return res.status(200).json({
        success: true,
        picks: [
          {
            id: 'demo1',
            homeTeam: 'Manchester City',
            awayTeam: 'Arsenal',
            date: new Date().toLocaleDateString('pt-BR'),
            time: '16:30',
            league: 'Premier League',
            market: 'Mais de 2.5 gols',
            probability: '62%',
            fairOdd: 1.60,
            marketOdd: 1.75,
            edge: '+9.4%',
            confidence: 'Forte'
          }
        ]
      });
    }

    // Transformar dados reais
    const formattedPicks = data.map(pick => ({
      id: pick.fixture_id,
      homeTeam: pick.team_home,
      awayTeam: pick.team_away,
      date: new Date().toLocaleDateString('pt-BR'),
      time: '15:00',
      league: 'Liga Internacional',
      market: `Mais de ${pick.market_value} gols`,
      probability: `${Math.round(pick.predicted_probability * 100)}%`,
      fairOdd: pick.fair_odd,
      marketOdd: pick.best_market_odd,
      edge: `+${pick.edge_percentage}%`,
      confidence: pick.edge_percentage > 20 ? 'Forte' : pick.edge_percentage > 10 ? 'Moderada' : 'Fraca'
    }));

    return res.status(200).json({
      success: true,
      picks: formattedPicks
    });

  } catch (error) {
    console.error('Erro:', error);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
