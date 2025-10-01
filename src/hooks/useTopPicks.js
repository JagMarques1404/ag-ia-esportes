import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export function useTopPicks() {
  const [picks, setPicks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchTopPicks = async () => {
    try {
      setLoading(true);
      
      // Buscar picks do dia atual ordenados por edge (maior primeiro)
      const today = new Date().toISOString().split('T')[0];
      
      const { data, error } = await supabase
        .from('recommendations')
        .select('*')
        .gte('match_date', today)
        .order('edge', { ascending: false })
        .limit(10);

      if (error) {
        console.error('Erro ao buscar picks:', error);
        // Se não houver dados no banco, usar dados de demonstração
        setPicks(getDemoData());
        setError(null);
      } else if (data && data.length > 0) {
        // Transformar dados do Supabase para o formato da interface
        const formattedPicks = data.map(pick => ({
          id: pick.fixture_id,
          homeTeam: pick.home_team,
          awayTeam: pick.away_team,
          date: new Date(pick.match_date).toLocaleDateString('pt-BR'),
          time: new Date(pick.match_date).toLocaleTimeString('pt-BR', { 
            hour: '2-digit', 
            minute: '2-digit' 
          }),
          league: 'Liga Internacional', // Placeholder
          market: pick.market,
          probability: `${pick.probability}%`,
          fairOdd: pick.fair_odd,
          marketOdd: pick.market_odd,
          edge: `+${pick.edge}%`,
          confidence: pick.confidence,
          analysis: `Modelo prevê ${pick.probability}% de chance. Probabilidade de mais de 2.5 gols. Odd justa ${pick.fair_odd}, mercado oferece ${pick.market_odd}. Edge de ${pick.edge}%.`
        }));
        
        setPicks(formattedPicks);
        setError(null);
      } else {
        // Se não houver picks para hoje, usar dados de demonstração
        setPicks(getDemoData());
        setError(null);
      }
    } catch (err) {
      console.error('Erro ao carregar picks:', err);
      setPicks(getDemoData());
      setError('Erro ao carregar dados. Exibindo dados de demonstração.');
    } finally {
      setLoading(false);
    }
  };

  // Dados de demonstração (fallback)
  const getDemoData = () => [
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
      confidence: 'Forte',
      analysis: 'Modelo prevê 2.8 gols totais (1.5 casa + 1.3 fora). Probabilidade de mais de 2.5: 62%. Odd justa 1.60, mercado oferece 1.75. Edge de 9.4%.'
    },
    {
      id: 'demo2',
      homeTeam: 'Real Madrid',
      awayTeam: 'Barcelona',
      date: new Date().toLocaleDateString('pt-BR'),
      time: '22:15',
      league: 'La Liga',
      market: 'Mais de 1.5 gols',
      probability: '79%',
      fairOdd: 1.27,
      marketOdd: 1.35,
      edge: '+6.3%',
      confidence: 'Forte',
      analysis: 'Clássico com histórico de muitos gols. Modelo prevê 3.1 gols totais. Probabilidade de mais de 1.5: 79%. Edge de 6.3%.'
    }
  ];

  useEffect(() => {
    fetchTopPicks();
    
    // Atualizar a cada 5 minutos
    const interval = setInterval(fetchTopPicks, 5 * 60 * 1000);
    
    return () => clearInterval(interval);
  }, []);

  return {
    picks,
    loading,
    error,
    refetch: fetchTopPicks
  };
}
