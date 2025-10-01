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
      .gte('match_date', today)
      .order('edge', { ascending: false })
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
      homeTeam: pick.home_team,
      awayTeam: pick.away_team,
      date: new Date(pick.match_date).toLocaleDateString('pt-BR'),
      time: new Date(pick.match_date).toLocaleTimeString('pt-BR', { 
        hour: '2-digit', 
        minute: '2-digit' 
      }),
      league: 'Liga Internacional',
      market: pick.market,
      probability: `${pick.probability}%`,
      fairOdd: pick.fair_odd,
      marketOdd: pick.market_odd,
      edge: `+${pick.edge}%`,
      confidence: pick.confidence
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
