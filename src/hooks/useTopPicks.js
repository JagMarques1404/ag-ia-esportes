import { useState, useEffect } from 'react';

/**
 * Hook para buscar os top picks do dia via API
 */
export function useTopPicks() {
  const [picks, setPicks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [source, setSource] = useState(null);

  const fetchTopPicks = async () => {
    try {
      setLoading(true);
      setError(null);

      // Buscar dados via endpoint da API
      const response = await fetch('/api/picks');
      
      if (!response.ok) {
        throw new Error(`Erro HTTP: ${response.status}`);
      }

      const result = await response.json();
      
      if (result.success && result.data) {
        setPicks(result.data);
        setLastUpdated(new Date(result.lastUpdated));
        setSource(result.source);
        
        // Log para debug
        console.log(`Dados carregados via ${result.source}:`, result.data.length, 'picks');
        if (result.error) {
          console.warn('Aviso:', result.error);
        }
      } else {
        throw new Error('Resposta da API inválida');
      }
    } catch (err) {
      console.error('Erro ao buscar top picks:', err);
      setError(`Erro ao carregar os picks do dia: ${err.message}`);
      
      // Em caso de erro total, usar dados mock locais
      setPicks(getMockPicks());
      setLastUpdated(new Date());
      setSource('local_mock');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTopPicks();
  }, []);

  const refetch = () => {
    fetchTopPicks();
  };

  return {
    picks,
    loading,
    error,
    lastUpdated,
    source,
    refetch
  };
}

/**
 * Dados mock locais para fallback extremo
 */
function getMockPicks() {
  return [
    {
      id: 'local-mock-1',
      fixture: {
        home_team: 'Manchester City',
        away_team: 'Arsenal',
        date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        league_name: 'Premier League',
        country: 'England'
      },
      market: {
        type: 'over_under_goals',
        value: '2.5',
        selection: 'over',
        display: 'Mais de 2.5 gols'
      },
      prediction: {
        probability: 0.6234,
        fairOdd: 1.60,
        marketOdd: 1.75,
        edge: 9.4,
        confidence: 0.8
      },
      explanation: 'Modelo prevê 2.8 gols totais (1.5 casa, 1.3 fora). Probabilidade de mais de 2.5: 62%. Odd justa: 1.60, mercado oferece: 1.75. Edge de 9.4%.',
      recommendation: 'Forte',
      createdAt: new Date().toISOString()
    },
    {
      id: 'local-mock-2',
      fixture: {
        home_team: 'Real Madrid',
        away_team: 'Barcelona',
        date: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
        league_name: 'La Liga',
        country: 'Spain'
      },
      market: {
        type: 'over_under_goals',
        value: '1.5',
        selection: 'over',
        display: 'Mais de 1.5 gols'
      },
      prediction: {
        probability: 0.7891,
        fairOdd: 1.27,
        marketOdd: 1.35,
        edge: 6.3,
        confidence: 0.9
      },
      explanation: 'Clássico com histórico de muitos gols. Modelo prevê 3.1 gols totais. Probabilidade de mais de 1.5: 79%. Edge de 6.3%.',
      recommendation: 'Forte',
      createdAt: new Date().toISOString()
    }
  ];
}
