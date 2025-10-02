import React, { useEffect, useState } from 'react';
import { Header } from './components/Header';
import { ValuePick } from './components/ValuePick';
import { HowItWorks } from './components/HowItWorks';
import './App.css';

function App() {
  const [picks, setPicks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Converte o objeto vindo da API (data/picks) para o shape do <ValuePick />
  const formatPick = (p) => {
    const kickoff = p.kickoff ?? p.kickoff_utc ?? null;
    const dt = kickoff ? new Date(kickoff) : null;

    const edge =
      typeof p.edgePct === 'number'
        ? p.edgePct
        : typeof p.edge_percentage === 'number'
        ? p.edge_percentage
        : null;

    const prob =
      typeof p.prob === 'number'
        ? p.prob
        : typeof p.probability === 'number'
        ? p.probability / 100
        : null;

    let marketLabel = p.market || 'Mercado';
    if (p.market && p.market.startsWith('goals_over_')) {
      const num = p.market.split('goals_over_')[1]?.replace('_', '.'); // "2_5" -> "2.5"
      marketLabel = `Mais de ${num} gols`;
    }

    return {
      id:
        p.id ||
        p.fixture_id ||
        p.fixture_ext_id ||
        `${p.homeTeam ?? p.home}-${p.awayTeam ?? p.away}-${p.market ?? ''}`,
      homeTeam: p.homeTeam ?? p.home ?? p.team_home ?? '',
      awayTeam: p.awayTeam ?? p.away ?? p.team_away ?? '',
      league: p.league ?? '',
      date: dt ? dt.toLocaleDateString('pt-BR') : '',
      time: dt
        ? dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        : '',
      market: marketLabel,
      probability: prob != null ? `${(prob * 100).toFixed(0)}%` : '',
      fairOdd: p.fairOdd ?? p.fair_odd ?? '',
      marketOdd: p.marketOdd ?? p.odd_mkt ?? '',
      edge: edge != null ? `+${edge.toFixed(1)}%` : '',
      confidence:
        p.confidence ??
        (edge != null
          ? edge >= 20
            ? 'Forte'
            : edge >= 10
            ? 'Moderada'
            : 'Observação'
          : ''),
    };
  };

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/picks', { cache: 'no-store' });
        const j = await r.json();
        const list = Array.isArray(j?.data)
          ? j.data
          : Array.isArray(j?.picks)
          ? j.picks
          : [];
        setPicks(list.map(formatPick));
      } catch (e) {
        console.error('Erro ao buscar picks', e);
        setError('Erro ao carregar dados');
        setPicks([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Hero */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Picks de Valor com Inteligência Artificial
          </h1>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            Identificamos oportunidades no mercado de apostas esportivas usando
            modelos preditivos e análise de valor em tempo real.
          </p>
        </div>

        {/* Stats (placeholder) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <div className="bg-white rounded-lg shadow p-6 text-center">
            <div className="text-3xl font-bold text-green-600 mb-2">+6.7%</div>
            <div className="text-gray-600">Edge Médio</div>
          </div>
          <div className="bg-white rounded-lg shadow p-6 text-center">
            <div className="text-3xl font-bold text-blue-600 mb-2">73%</div>
            <div className="text-gray-600">Taxa de Acerto</div>
          </div>
          <div className="bg-white rounded-lg shadow p-6 text-center">
            <div className="text-3xl font-bold text-purple-600 mb-2">250+</div>
            <div className="text-gray-600">Jogos Analisados</div>
          </div>
        </div>

        {/* Top Picks */}
        <section className="mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-8 text-center">
            Top Picks do Dia
          </h2>

          {loading && (
            <div className="text-center py-8 text-gray-600">
              Carregando picks do dia...
            </div>
          )}

          {!loading && error && (
            <div className="text-center py-8 text-red-600">{error}</div>
          )}

          {!loading && !error && picks.length === 0 && (
            <div className="text-center py-8 text-gray-600">
              Nenhum pick disponível no momento
            </div>
          )}

          {!loading && !error && picks.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {picks.map((pick, index) => (
                <ValuePick key={pick.id || index} pick={pick} />
              ))}
            </div>
          )}
        </section>

        <HowItWorks />
      </main>
    </div>
  );
}

export default App;
