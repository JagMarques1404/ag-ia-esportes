import { useState } from 'react'
import { Header } from './components/Header'
import { ValuePick } from './components/ValuePick'
import { HowItWorks } from './components/HowItWorks'
import { useTopPicks } from './hooks/useTopPicks'
import './App.css'

function App() {
  const { picks, loading, error } = useTopPicks();

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Picks de Valor com Inteligência Artificial
          </h1>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            Identificamos oportunidades no mercado de apostas esportivas usando 
            modelos preditivos e análise de valor em tempo real.
          </p>
        </div>

        {/* Stats */}
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
            <div className="text-center py-8">
              <div className="text-gray-600">Carregando picks do dia...</div>
            </div>
          )}
          
          {error && (
            <div className="text-center py-8">
              <div className="text-red-600">Erro ao carregar dados</div>
            </div>
          )}
          
          {!loading && !error && picks && picks.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {picks.map((pick, index) => (
                <ValuePick key={pick.id || index} pick={pick} />
              ))}
            </div>
          )}
          
          {!loading && !error && (!picks || picks.length === 0) && (
            <div className="text-center py-8">
              <div className="text-gray-600">Nenhum pick disponível no momento</div>
            </div>
          )}
        </section>

        <HowItWorks />
      </main>
    </div>
  )
}

export default App
