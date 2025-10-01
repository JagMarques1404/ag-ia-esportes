import { useState, useEffect } from 'react';

export function useTopPicks() {
  const [picks, setPicks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchTopPicks = async () => {
    try {
      setLoading(true);
      
      const response = await fetch('/api/picks');
      
      if (!response.ok) {
        throw new Error('Erro na resposta da API');
      }
      
      const data = await response.json();
      
      if (data.success && data.picks) {
        // Adicionar análise para cada pick
        const picksWithAnalysis = data.picks.map(pick => ({
          ...pick,
          analysis: `Modelo prevê ${pick.probability} de chance. ${pick.market}. Odd justa ${pick.fairOdd}, mercado oferece ${pick.marketOdd}. Edge de ${pick.edge}.`
        }));
        
        setPicks(picksWithAnalysis);
        setError(null);
      } else {
        throw new Error('Formato de dados inválido');
      }
    } catch (err) {
      console.error('Erro ao carregar picks:', err);
      
      // Fallback para dados demo
      setPicks([
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
          analysis: 'Modelo prevê 62% de chance. Mais de 2.5 gols. Odd justa 1.60, mercado oferece 1.75. Edge de +9.4%.'
        }
      ]);
      setError('Usando dados de demonstração');
    } finally {
      setLoading(false);
    }
  };

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
