import { useState, useEffect } from 'react';

export function useTopPicks() {
  const [picks, setPicks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchTopPicks = async () => {
    try {
      setLoading(true);
      
      const response = await fetch('/api/picks');
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
        setError('Erro ao carregar picks');
      }
    } catch (err) {
      console.error('Erro ao carregar picks:', err);
      setError('Erro ao carregar dados');
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
