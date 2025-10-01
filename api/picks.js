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
    console.log('🔍 Buscando picks no banco...');
    
    // Buscar TODOS os picks (sem filtro de data)
    const { data, error } = await supabase
      .from('recommendations')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);

    console.log('📊 Resultado da query:', { 
      error: error?.message, 
      count: data?.length || 0,
      firstPick: data?.[0] ? {
        team_home: data[0].team_home,
        team_away: data[0].team_away,
        edge: data[0].edge_percentage
      } : null
    });

    if (error) {
      console.error('❌ Erro na query:', error);
    }

    if (!data || data.length === 0) {
      console.log('⚠️ Nenhum dado encontrado, retornando demo');
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

    console.log('✅ Transformando dados reais...');
    
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
      edge: `+${pick.edge_percentage.toFixed(1)}%`,
      confidence: pick.edge_percentage > 20 ? 'Forte' : pick.edge_percentage > 10 ? 'Moderada' : 'Fraca'
    }));

    console.log('🎯 Retornando picks formatados:', formattedPicks.length);

    return res.status(200).json({
      success: true,
      picks: formattedPicks
    });

  } catch (error) {
    console.error('❌ Erro geral:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Erro interno',
      details: error.message 
    });
  }
}
