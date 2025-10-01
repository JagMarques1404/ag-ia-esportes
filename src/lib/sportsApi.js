/**
 * AG IA ESPORTES - Integração com APIs de Dados Esportivos
 * Serviços para buscar fixtures, odds e dados de times
 */

import axios from 'axios';

// Configurações das APIs
const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

const apiFootballKey = import.meta.env.VITE_APIFOOTBALL_KEY;
const oddsApiKey = import.meta.env.VITE_THEODDSAPI_KEY;

// Cliente para API-Football
const apiFootballClient = axios.create({
  baseURL: API_FOOTBALL_BASE,
  headers: {
    'X-RapidAPI-Key': apiFootballKey,
    'X-RapidAPI-Host': 'v3.football.api-sports.io'
  }
});

// Cliente para The Odds API
const oddsApiClient = axios.create({
  baseURL: ODDS_API_BASE,
  params: {
    apiKey: oddsApiKey
  }
});

/**
 * Buscar fixtures (jogos) para as próximas 72 horas
 * @param {string} date - Data no formato YYYY-MM-DD (opcional, padrão hoje)
 * @returns {Promise<Array>} Array de fixtures
 */
export async function fetchUpcomingFixtures(date = null) {
  try {
    const targetDate = date || new Date().toISOString().split('T')[0];
    
    // Buscar jogos das principais ligas
    const leagues = [
      39,  // Premier League
      140, // La Liga
      135, // Serie A
      78,  // Bundesliga
      61,  // Ligue 1
      71,  // Brasileirão Série A
      73,  // Copa do Brasil
      2,   // UEFA Champions League
      3,   // UEFA Europa League
    ];

    const fixtures = [];
    
    for (const leagueId of leagues) {
      try {
        const response = await apiFootballClient.get('/fixtures', {
          params: {
            league: leagueId,
            date: targetDate,
            status: 'NS' // Not Started
          }
        });

        if (response.data.response) {
          fixtures.push(...response.data.response.map(fixture => ({
            api_fixture_id: fixture.fixture.id,
            date: fixture.fixture.date,
            status: fixture.fixture.status.short,
            home_team: fixture.teams.home.name,
            away_team: fixture.teams.away.name,
            home_team_id: fixture.teams.home.id,
            away_team_id: fixture.teams.away.id,
            league_name: fixture.league.name,
            league_id: fixture.league.id,
            country: fixture.league.country,
            season: fixture.league.season
          })));
        }
      } catch (error) {
        console.error(`Erro ao buscar fixtures da liga ${leagueId}:`, error.message);
      }
    }

    return fixtures;
  } catch (error) {
    console.error('Erro ao buscar fixtures:', error);
    throw new Error('Falha ao buscar jogos das APIs');
  }
}

/**
 * Buscar odds para um jogo específico
 * @param {number} fixtureId - ID do fixture na API-Football
 * @returns {Promise<Array>} Array de odds
 */
export async function fetchFixtureOdds(fixtureId) {
  try {
    // Buscar odds da API-Football (mais confiável para mercados específicos)
    const response = await apiFootballClient.get('/odds', {
      params: {
        fixture: fixtureId,
        bet: 5 // Goals Over/Under
      }
    });

    const odds = [];
    
    if (response.data.response && response.data.response.length > 0) {
      const fixtureOdds = response.data.response[0];
      
      fixtureOdds.bookmakers.forEach(bookmaker => {
        bookmaker.bets.forEach(bet => {
          if (bet.name === 'Goals Over/Under') {
            bet.values.forEach(value => {
              // Processar Over/Under para diferentes valores
              const [selection, marketValue] = value.value.includes('Over') 
                ? ['over', value.value.replace('Over ', '')]
                : ['under', value.value.replace('Under ', '')];

              odds.push({
                api_fixture_id: fixtureId,
                bookmaker: bookmaker.name,
                market_type: 'over_under_goals',
                market_value: marketValue,
                selection: selection,
                odd_value: parseFloat(value.odd)
              });
            });
          }
        });
      });
    }

    return odds;
  } catch (error) {
    console.error('Erro ao buscar odds:', error);
    return [];
  }
}

/**
 * Buscar odds de múltiplas casas para melhor comparação
 * @param {Array} fixtures - Array de fixtures
 * @returns {Promise<Array>} Array de odds consolidadas
 */
export async function fetchMultipleFixturesOdds(fixtures) {
  const allOdds = [];
  
  // Processar em lotes para não sobrecarregar a API
  const batchSize = 5;
  for (let i = 0; i < fixtures.length; i += batchSize) {
    const batch = fixtures.slice(i, i + batchSize);
    
    const batchPromises = batch.map(async (fixture) => {
      try {
        const odds = await fetchFixtureOdds(fixture.api_fixture_id);
        return odds;
      } catch (error) {
        console.error(`Erro ao buscar odds do fixture ${fixture.api_fixture_id}:`, error);
        return [];
      }
    });

    const batchResults = await Promise.all(batchPromises);
    allOdds.push(...batchResults.flat());

    // Delay entre lotes para respeitar rate limits
    if (i + batchSize < fixtures.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return allOdds;
}

/**
 * Buscar estatísticas básicas de um time (para futuras melhorias do modelo)
 * @param {number} teamId - ID do time
 * @param {number} season - Temporada
 * @returns {Promise<Object>} Estatísticas do time
 */
export async function fetchTeamStats(teamId, season = 2024) {
  try {
    const response = await apiFootballClient.get('/teams/statistics', {
      params: {
        team: teamId,
        season: season,
        league: 39 // Premier League como padrão, ajustar conforme necessário
      }
    });

    if (response.data.response) {
      const stats = response.data.response;
      return {
        team_id: teamId,
        goals_for: stats.goals.for.total.total,
        goals_against: stats.goals.against.total.total,
        matches_played: stats.fixtures.played.total,
        wins: stats.fixtures.wins.total,
        draws: stats.fixtures.draws.total,
        losses: stats.fixtures.loses.total,
        avg_goals_for: stats.goals.for.average.total,
        avg_goals_against: stats.goals.against.average.total
      };
    }

    return null;
  } catch (error) {
    console.error('Erro ao buscar estatísticas do time:', error);
    return null;
  }
}

/**
 * Função para testar conectividade das APIs
 * @returns {Promise<Object>} Status das APIs
 */
export async function testApiConnectivity() {
  const results = {
    apiFootball: false,
    oddsApi: false,
    errors: []
  };

  // Testar API-Football
  try {
    await apiFootballClient.get('/status');
    results.apiFootball = true;
  } catch (error) {
    results.errors.push(`API-Football: ${error.message}`);
  }

  // Testar The Odds API
  try {
    await oddsApiClient.get('/sports');
    results.oddsApi = true;
  } catch (error) {
    results.errors.push(`The Odds API: ${error.message}`);
  }

  return results;
}

/**
 * Função utilitária para formatar data para as APIs
 * @param {Date} date - Data a ser formatada
 * @returns {string} Data no formato YYYY-MM-DD
 */
export function formatDateForApi(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Função para calcular a melhor odd disponível para uma seleção
 * @param {Array} odds - Array de odds para o mesmo mercado
 * @returns {Object} Melhor odd encontrada
 */
export function getBestOdd(odds) {
  if (!odds || odds.length === 0) return null;
  
  return odds.reduce((best, current) => {
    return current.odd_value > best.odd_value ? current : best;
  });
}
