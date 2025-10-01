import { useState, useEffect } from 'react';
import { Header, HeaderStats } from './components/Header.jsx';
import { ValuePicksList } from './components/ValuePick.jsx';
import { HowItWorks, ModelStats } from './components/HowItWorks.jsx';
import { useTopPicks } from './hooks/useTopPicks.js';
import { Button } from '@/components/ui/button.jsx';
import { RefreshCw, AlertCircle } from 'lucide-react';
import './App.css';

function App() {
  const { picks, loading, error, lastUpdated, refetch } = useTopPicks();
  const [headerStats, setHeaderStats] = useState(null);

  // Calcular estatísticas para o header
  useEffect(() => {
    if (picks.length > 0 && lastUpdated) {
      const averageEdge = picks.reduce((sum, pick) => sum + pick.prediction.edge, 0) / picks.length;
      
      setHeaderStats({
        lastUpdate: lastUpdated.toLocaleString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        }),
        totalPicks: picks.length,
        averageEdge: averageEdge.toFixed(1)
      });
    }
  }, [picks, lastUpdated]);

  const handleRefresh = () => {
    refetch();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <Header />
      {headerStats && <HeaderStats stats={headerStats} />}

      {/* Hero Section */}
      <section className="bg-white py-12 border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Picks de Valor com Inteligência Artificial
          </h1>
          <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto">
            Identificamos oportunidades no mercado de apostas esportivas usando 
            modelos estatísticos avançados e análise de dados em tempo real.
          </p>
          
          {/* Botão de atualização */}
          <div className="flex items-center justify-center gap-4">
            <Button 
              onClick={handleRefresh} 
              disabled={loading}
              className="flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              {loading ? 'Carregando...' : 'Atualizar Picks'}
            </Button>
            
            {error && (
              <div className="flex items-center gap-2 text-red-600 text-sm">
                <AlertCircle className="w-4 h-4" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Top Picks Section */}
      <section id="home" className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {loading ? (
            <div className="text-center py-12">
              <RefreshCw className="w-8 h-8 text-primary animate-spin mx-auto mb-4" />
              <p className="text-gray-600">Carregando picks do dia...</p>
            </div>
          ) : (
            <ValuePicksList picks={picks} />
          )}
        </div>
      </section>

      {/* Model Stats */}
      <ModelStats />

      {/* How It Works */}
      <HowItWorks />

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid gap-8 md:grid-cols-3">
            <div>
              <h3 className="text-lg font-semibold mb-4">AG IA ESPORTES</h3>
              <p className="text-gray-400 text-sm leading-relaxed">
                Sistema de análise esportiva baseado em inteligência artificial 
                para identificação de oportunidades de valor no mercado de apostas.
              </p>
            </div>
            
            <div>
              <h3 className="text-lg font-semibold mb-4">Recursos</h3>
              <ul className="space-y-2 text-sm text-gray-400">
                <li>• Modelo Poisson bivariado</li>
                <li>• Análise de edge em tempo real</li>
                <li>• Atualização diária automática</li>
                <li>• Transparência total nos cálculos</li>
              </ul>
            </div>
            
            <div>
              <h3 className="text-lg font-semibold mb-4">Responsabilidade</h3>
              <p className="text-gray-400 text-sm leading-relaxed">
                Jogue com responsabilidade. Apostas envolvem risco e podem causar 
                dependência. Este sistema é destinado apenas a maiores de 18 anos.
              </p>
            </div>
          </div>
          
          <div className="border-t border-gray-800 mt-8 pt-8 text-center text-sm text-gray-400">
            <p>© 2024 AG IA ESPORTES. Todos os direitos reservados.</p>
            <p className="mt-2">
              Desenvolvido com React + Supabase + Vercel
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
