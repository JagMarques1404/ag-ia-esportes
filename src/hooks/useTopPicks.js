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

      console.log('🔄 Buscando dados via /api/picks...');

      // Buscar dados via endpoint da API
      const response = await fetch('/api/picks');
      
      console.log('📡 Resposta da API:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok
      });

      if (!response.ok) {
        throw new Error(`Erro HTTP: ${response.status} - ${response.statusText}`);
      }

      // Tentar fazer parse do JSON
      let result;
      try {
        result = await response.json();
        console.log('📋 Dados recebidos:', result);
      } catch (parseError) {
        console.error('❌ Erro ao fazer parse do JSON:', parseError);
        throw new Error('Resposta da API não é um JSON válido');
      }
      
      // Verificar se a resposta tem a estrutura esperada
      if (!result || typeof result !== 'object') {
        console.error('❌ Resposta não é um objeto:', result);
        throw new Error('Resposta da API tem formato inválido');
      }

      if (!result.success) {
        console.error('❌ API retornou success=false:', result);
        throw new Error(result.error || 'API retornou erro');
      }

      if (!Array.isArray(result.data)) {
        console.error('❌ Campo data não é um array:', result.data);
        throw new Error('Dados da API têm formato inválido');
      }

      // Sucesso - processar dados
      setPicks(result.data);
      setLastUpdated(new Date(result.lastUpdated));
      setSource(result.source);
      
      console.log(`✅ Dados carregados via ${result.source}:`, result.data.length, 'picks');
      
      if (result.error) {
        console.warn('⚠️ Aviso da API:', result.error);
      }

    } catch (err) {
      console.error('❌ Erro ao buscar top picks:', err);
      setError(`Erro ao carregar os picks do dia: ${err.message}`);
      
      // Em caso de erro total, usar dados mock locais
      console.log('🔄 Usando dados mock locais como fallback...');
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
    },
    {
      id: 'local-mock-3',
      fixture: {
        home_team: 'Flamengo',
        away_team: 'Palmeiras',
        date: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        league_name: 'Brasileirão Série A',
        country: 'Brazil'
      },
      market: {
        type: 'over_under_goals',
        value: '2.5',
        selection: 'under',
        display: 'Menos de 2.5 gols'
      },
      prediction: {
        probability: 0.5432,
        fairOdd: 1.84,
        marketOdd: 1.95,
        edge: 6.0,
        confidence: 0.7
      },
      explanation: 'Jogo equilibrado entre defesas sólidas. Modelo prevê 2.2 gols totais. Probabilidade de menos de 2.5: 54%. Edge de 6.0%.',
      recommendation: 'Moderada',
      createdAt: new Date().toISOString()
    },
    {
      id: 'local-mock-4',
      fixture: {
        home_team: 'Bayern Munich',
        away_team: 'Borussia Dortmund',
        date: new Date(Date.now() + 60 * 60 * 60 * 1000).toISOString(),
        league_name: 'Bundesliga',
        country: 'Germany'
      },
      market: {
        type: 'over_under_goals',
        value: '3.5',
        selection: 'over',
        display: 'Mais de 3.5 gols'
      },
      prediction: {
        probability: 0.4567,
        fairOdd: 2.19,
        marketOdd: 2.30,
        edge: 5.0,
        confidence: 0.6
      },
      explanation: 'Der Klassiker com ataques potentes. Modelo prevê 3.4 gols totais. Probabilidade de mais de 3.5: 46%. Edge de 5.0%.',
      recommendation: 'Moderada',
      createdAt: new Date().toISOString()
    }
  ];
}
