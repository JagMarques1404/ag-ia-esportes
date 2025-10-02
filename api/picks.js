import { createClient } from '@supabase/supabase-js'

// ✅ USAR AS VARIÁVEIS CORRETAS
const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY

let supabase = null

// Inicializar Supabase apenas se as variáveis estiverem disponíveis
if (supabaseUrl && supabaseAnonKey) {
  supabase = createClient(supabaseUrl, supabaseAnonKey)
}

/**
 * Buscar publicação do dia por tipo
 */
async function getTodayPublication(type) {
  if (!supabase) {
    return null
  }

  try {
    const today = new Date().toISOString().split('T')[0]
    
    const { data, error } = await supabase
      .from('daily_publications')
      .select('*')
      .eq('publication_type', type)
      .eq('publication_date', today)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (error && error.code !== 'PGRST116') {
      console.error('Erro ao buscar publicação:', error)
      return null
    }

    return data
  } catch (err) {
    console.error('Erro na consulta Supabase:', err)
    return null
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
 * Serverless Function Handler
 */
export default async function handler(req, res) {
  // Configurar CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  // Permitir apenas GET
  if (req.method !== 'GET') {
    return res.status(405).json({ 
      success: false, 
      error: 'Método não permitido' 
    })
  }

  try {
    console.log('🔄 Processando requisição /api/picks')

    // Tentar buscar dados reais do Supabase
    const publication = await getTodayPublication('top_picks')
    
    if (publication && publication.content) {
      console.log('✅ Dados encontrados no Supabase')
      return res.status(200).json({
        success: true,
        data: publication.content,  // ✅ USAR 'data' (não 'picks')
        lastUpdated: publication.created_at,
        source: 'database'
      })
    } else {
      console.log('⚠️ Nenhum dado no Supabase, usando mock')
      return res.status(200).json({
        success: true,
        data: getMockPicks(),  // ✅ USAR 'data' (não 'picks')
        lastUpdated: new Date().toISOString(),
        source: 'mock'
      })
    }
  } catch (error) {
    console.error('❌ Erro na API:', error)
    
    // Sempre retornar dados mock em caso de erro
    return res.status(200).json({
      success: true,
      data: getMockPicks(),  // ✅ USAR 'data' (não 'picks')
      lastUpdated: new Date().toISOString(),
      source: 'mock',
      error: 'Erro interno do servidor'
    })
  }
}
