// api/picks.js - Handler robusto que SEMPRE retorna JSON
import { createClient } from '@supabase/supabase-js'

// ✅ Usar variáveis SEM prefixo VITE_ (para servidor)
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

let supabase = null

// Inicializar Supabase apenas se as variáveis estiverem disponíveis
if (supabaseUrl && supabaseKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey)
  } catch (err) {
    console.error('❌ Erro ao inicializar Supabase:', err)
  }
}

/**
 * Buscar dados do Supabase (com fallback para diferentes estruturas)
 */
async function fetchPicksFromSupabase() {
  if (!supabase) {
    throw new Error('Supabase não inicializado - verifique variáveis de ambiente')
  }

  try {
    // Tentar buscar da tabela daily_publications primeiro
    const today = new Date().toISOString().split('T')[0]
    
    const { data: publication, error: pubError } = await supabase
      .from('daily_publications')
      .select('*')
      .eq('publication_type', 'top_picks')
      .eq('publication_date', today)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (!pubError && publication && publication.content) {
      return {
        data: publication.content,
        source: 'daily_publications',
        lastUpdated: publication.created_at
      }
    }

    // Fallback: tentar buscar da tabela recommendations
    const { data: recommendations, error: recError } = await supabase
      .from('recommendations')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10)

    if (!recError && recommendations && recommendations.length > 0) {
      return {
        data: recommendations,
        source: 'recommendations',
        lastUpdated: new Date().toISOString()
      }
    }

    // Se chegou aqui, não há dados
    return null

  } catch (err) {
    console.error('❌ Erro ao buscar dados do Supabase:', err)
    throw err
  }
}

/**
 * Dados mock para demonstração
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
 * Serverless Function Handler - SEMPRE retorna JSON
 */
export default async function handler(req, res) {
  // ✅ SEMPRE configurar headers JSON primeiro
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ success: true })
  }

  // Permitir apenas GET
  if (req.method !== 'GET') {
    return res.status(405).json({ 
      success: false, 
      error: 'Método não permitido',
      data: []
    })
  }

  try {
    console.log('🔄 [api/picks] Iniciando processamento...')
    console.log('🔧 [api/picks] Variáveis disponíveis:', {
      SUPABASE_URL: !!process.env.SUPABASE_URL,
      VITE_SUPABASE_URL: !!process.env.VITE_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      SUPABASE_ANON_KEY: !!process.env.SUPABASE_ANON_KEY,
      VITE_SUPABASE_ANON_KEY: !!process.env.VITE_SUPABASE_ANON_KEY
    })

    // Tentar buscar dados reais do Supabase
    let result = null
    let error = null

    try {
      result = await fetchPicksFromSupabase()
      console.log('✅ [api/picks] Dados do Supabase:', result ? `${result.data.length} items de ${result.source}` : 'nenhum')
    } catch (supabaseError) {
      console.error('❌ [api/picks] Erro do Supabase:', supabaseError.message)
      error = supabaseError.message
    }

    if (result && result.data && result.data.length > 0) {
      // Sucesso - dados reais
      return res.status(200).json({
        success: true,
        data: result.data,
        lastUpdated: result.lastUpdated,
        source: result.source,
        count: result.data.length
      })
    } else {
      // Fallback - dados mock
      console.log('⚠️ [api/picks] Usando dados mock como fallback')
      const mockData = getMockPicks()
      
      return res.status(200).json({
        success: true,
        data: mockData,
        lastUpdated: new Date().toISOString(),
        source: 'mock',
        count: mockData.length,
        warning: error || 'Nenhum dado encontrado no banco'
      })
    }

  } catch (criticalError) {
    // ✅ SEMPRE retornar JSON, mesmo em erro crítico
    console.error('💥 [api/picks] Erro crítico:', criticalError)
    
    const mockData = getMockPicks()
    
    return res.status(200).json({
      success: false,
      data: mockData,
      lastUpdated: new Date().toISOString(),
      source: 'mock_fallback',
      count: mockData.length,
      error: criticalError.message || 'Erro interno do servidor'
    })
  }
}
