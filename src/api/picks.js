import { createClient } from '@supabase/supabase-js'

// Configuração do Supabase para o backend (usando variáveis de ambiente do servidor)
const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Variáveis de ambiente do Supabase não configuradas no servidor')
}

const supabase = createClient(supabaseUrl, supabaseAnonKey)

/**
 * Buscar publicação do dia por tipo
 */
async function getTodayPublication(type) {
  const today = new Date().toISOString().split('T')[0]
  
  const { data, error } = await supabase
    .from('daily_publications')
    .select('*')
    .eq('publication_type', type)
    .eq('publication_date', today)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
    console.error('Erro ao buscar publicação:', error)
    throw error
  }

  return data
}

/**
 * Dados mock para demonstração (quando não há dados reais)
 */
function getMockPicks() {
  return [
    {
      id: 'mock-1',
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
      id: 'mock-2',
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
      id: 'mock-3',
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
      id: 'mock-4',
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
  ]
}

/**
 * Endpoint principal para buscar os top picks do dia
 */
export default async function handler(req, res) {
  // Permitir apenas métodos GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  try {
    // Buscar publicação do dia
    const publication = await getTodayPublication('top_picks')
    
    if (publication && publication.content) {
      // Retornar dados reais do banco
      return res.status(200).json({
        success: true,
        data: publication.content,
        lastUpdated: publication.created_at,
        source: 'database'
      })
    } else {
      // Retornar dados mock se não há publicação do dia
      return res.status(200).json({
        success: true,
        data: getMockPicks(),
        lastUpdated: new Date().toISOString(),
        source: 'mock'
      })
    }
  } catch (error) {
    console.error('Erro no endpoint /api/picks:', error)
    
    // Em caso de erro, retornar dados mock
    return res.status(200).json({
      success: true,
      data: getMockPicks(),
      lastUpdated: new Date().toISOString(),
      source: 'mock',
      error: 'Erro ao conectar com banco de dados'
    })
  }
}
