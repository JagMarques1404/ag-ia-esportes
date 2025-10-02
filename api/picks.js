// api/picks.js — CommonJS + dynamic import (máxima compatibilidade)
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end(JSON.stringify({ ok: true }))
  }
  
  if (req.method !== 'GET') {
    return res.status(405).end(JSON.stringify({ 
      success: false, 
      error: 'Método não permitido', 
      data: [] 
    }))
  }

  // Dynamic import evita erro ESM/CJS
  let createClient
  try {
    ({ createClient } = await import('@supabase/supabase-js'))
  } catch (e) {
    return res.status(200).end(JSON.stringify({
      success: false, 
      source: 'mock_fallback',
      error: `Falha ao importar supabase-js: ${e?.message || e}`, 
      data: getMock(),
      count: getMock().length
    }))
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  
  if (!SUPABASE_URL || !KEY) {
    return res.status(200).end(JSON.stringify({
      success: false, 
      source: 'mock_fallback',
      error: 'SUPABASE_URL ou KEY ausentes (Vercel Production).', 
      data: getMock(),
      count: getMock().length
    }))
  }

  const supabase = createClient(SUPABASE_URL, KEY)
  const todayBR = getTodayBR()

  try {
    // 1) Tentar daily_publications (top_picks na data BR)
    const pub = await supabase
      .from('daily_publications')
      .select('*')
      .eq('publication_type', 'top_picks')
      .eq('publication_date', todayBR)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (pub.data?.content?.length) {
      return res.status(200).end(JSON.stringify({
        success: true, 
        source: 'daily_publications',
        lastUpdated: pub.data.created_at,
        count: pub.data.content.length, 
        data: pub.data.content
      }))
    }

    // 2) Fallback: recommendations
    const rec = await supabase
      .from('recommendations')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10)

    if (rec.data?.length) {
      return res.status(200).end(JSON.stringify({
        success: true, 
        source: 'recommendations',
        lastUpdated: new Date().toISOString(),
        count: rec.data.length, 
        data: rec.data
      }))
    }

    // 3) Mock final
    return res.status(200).end(JSON.stringify({
      success: true, 
      source: 'mock',
      lastUpdated: new Date().toISOString(),
      count: getMock().length, 
      warning: 'Sem dados no banco', 
      data: getMock()
    }))
    
  } catch (e) {
    return res.status(200).end(JSON.stringify({
      success: false, 
      source: 'mock_fallback',
      error: String(e?.message || e), 
      data: getMock(),
      count: getMock().length
    }))
  }
}

function getTodayBR() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getMock() {
  return [
    {
      id: 'm1',
      fixture: {
        home_team: 'Flamengo',
        away_team: 'Palmeiras',
        date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        league_name: 'Brasileirão Série A',
        country: 'Brazil'
      },
      market: {
        type: 'over_under_goals',
        value: '2.5',
        selection: 'over',
        display: 'Mais de 2.5 gols'
      },
      prediction: {
        probability: 0.62,
        fairOdd: 1.61,
        marketOdd: 1.75,
        edge: 8.7,
        confidence: 0.8
      },
      explanation: 'Clássico brasileiro com histórico de gols. Modelo prevê 2.8 gols totais. Edge de 8.7%.',
      recommendation: 'Forte',
      createdAt: new Date().toISOString()
    },
    {
      id: 'm2',
      fixture: {
        home_team: 'Manchester City',
        away_team: 'Arsenal',
        date: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
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
        probability: 0.68,
        fairOdd: 1.47,
        marketOdd: 1.65,
        edge: 12.2,
        confidence: 0.85
      },
      explanation: 'Confronto direto entre ataques potentes. Probabilidade alta de mais de 2.5 gols.',
      recommendation: 'Forte',
      createdAt: new Date().toISOString()
    },
    {
      id: 'm3',
      fixture: {
        home_team: 'Real Madrid',
        away_team: 'Barcelona',
        date: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
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
        probability: 0.79,
        fairOdd: 1.27,
        marketOdd: 1.35,
        edge: 6.3,
        confidence: 0.9
      },
      explanation: 'El Clásico raramente termina com poucos gols. Probabilidade de 79% para mais de 1.5.',
      recommendation: 'Forte',
      createdAt: new Date().toISOString()
    },
    {
      id: 'm4',
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
        probability: 0.46,
        fairOdd: 2.17,
        marketOdd: 2.30,
        edge: 6.0,
        confidence: 0.7
      },
      explanation: 'Der Klassiker alemão com ataques explosivos. Modelo prevê 3.4 gols totais.',
      recommendation: 'Moderada',
      createdAt: new Date().toISOString()
    }
  ]
}
