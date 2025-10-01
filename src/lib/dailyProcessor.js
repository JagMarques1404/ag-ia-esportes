/**
 * AG IA ESPORTES - Processador Diário
 * Orquestra a ingestão de dados, processamento do modelo e geração de picks
 */

import { 
  fetchUpcomingFixtures, 
  fetchMultipleFixturesOdds,
  testApiConnectivity 
} from './sportsApi.js';
import { 
  generateRecommendations, 
  validateMatchData 
} from './poissonModel.js';
import {
  upsertFixtures,
  insertOddsSnapshots,
  insertRecommendations,
  getTopRecommendations,
  saveDailyPublication,
  startModelRun,
  completeModelRun,
  failModelRun
} from './database.js';

/**
 * Executar o processamento diário completo
 * @returns {Promise<Object>} Resultado do processamento
 */
export async function runDailyProcessing() {
  const startTime = Date.now();
  let modelRunId = null;
  
  try {
    console.log('🚀 Iniciando processamento diário AG IA ESPORTES');
    
    // 1. Iniciar registro da execução
    const modelRun = await startModelRun('poisson_v1');
    modelRunId = modelRun.id;
    console.log(`📊 Execução registrada: ID ${modelRunId}`);

    // 2. Testar conectividade das APIs
    console.log('🔗 Testando conectividade das APIs...');
    const apiStatus = await testApiConnectivity();
    if (!apiStatus.apiFootball && !apiStatus.oddsApi) {
      throw new Error('Nenhuma API está disponível: ' + apiStatus.errors.join(', '));
    }
    console.log('✅ APIs conectadas:', { 
      apiFootball: apiStatus.apiFootball, 
      oddsApi: apiStatus.oddsApi 
    });

    // 3. Buscar fixtures das próximas 72 horas
    console.log('📅 Buscando jogos das próximas 72 horas...');
    const fixtures = await fetchUpcomingFixtures();
    console.log(`🎯 Encontrados ${fixtures.length} jogos`);

    if (fixtures.length === 0) {
      console.log('⚠️ Nenhum jogo encontrado para processar');
      await completeModelRun(modelRunId, {
        fixturesProcessed: 0,
        recommendationsGenerated: 0,
        executionTimeSeconds: Math.round((Date.now() - startTime) / 1000)
      });
      return { success: true, message: 'Nenhum jogo para processar' };
    }

    // 4. Salvar fixtures no banco
    console.log('💾 Salvando jogos no banco de dados...');
    const savedFixtures = await upsertFixtures(fixtures);
    console.log(`✅ ${savedFixtures.length} jogos salvos`);

    // 5. Buscar odds para os fixtures
    console.log('💰 Buscando odds dos jogos...');
    const allOdds = await fetchMultipleFixturesOdds(fixtures);
    console.log(`📊 Coletadas ${allOdds.length} odds`);

    // 6. Salvar odds no banco
    if (allOdds.length > 0) {
      console.log('💾 Salvando odds no banco de dados...');
      
      // Enriquecer odds com fixture_id do banco
      const enrichedOdds = await enrichOddsWithFixtureIds(allOdds, savedFixtures);
      await insertOddsSnapshots(enrichedOdds);
      console.log(`✅ ${enrichedOdds.length} odds salvas`);
    }

    // 7. Processar recomendações
    console.log('🧠 Processando modelo e gerando recomendações...');
    const allRecommendations = await processRecommendations(savedFixtures, allOdds);
    console.log(`🎯 Geradas ${allRecommendations.length} recomendações`);

    // 8. Salvar recomendações
    if (allRecommendations.length > 0) {
      await insertRecommendations(allRecommendations);
      console.log('✅ Recomendações salvas no banco');
    }

    // 9. Gerar Top Picks do dia
    console.log('🏆 Gerando Top Picks do dia...');
    const topPicks = await generateTopPicks();
    console.log(`⭐ ${topPicks.length} picks selecionados`);

    // 10. Salvar publicação diária
    const today = new Date().toISOString().split('T')[0];
    await saveDailyPublication(today, 'top_picks', topPicks);
    console.log('📰 Publicação diária salva');

    // 11. Finalizar execução
    const executionTime = Math.round((Date.now() - startTime) / 1000);
    await completeModelRun(modelRunId, {
      fixturesProcessed: fixtures.length,
      recommendationsGenerated: allRecommendations.length,
      executionTimeSeconds: executionTime
    });

    console.log(`🎉 Processamento concluído em ${executionTime}s`);
    
    return {
      success: true,
      stats: {
        fixturesProcessed: fixtures.length,
        oddsCollected: allOdds.length,
        recommendationsGenerated: allRecommendations.length,
        topPicksGenerated: topPicks.length,
        executionTimeSeconds: executionTime
      }
    };

  } catch (error) {
    console.error('❌ Erro no processamento diário:', error);
    
    if (modelRunId) {
      await failModelRun(modelRunId, error.message);
    }
    
    return {
      success: false,
      error: error.message,
      executionTimeSeconds: Math.round((Date.now() - startTime) / 1000)
    };
  }
}

/**
 * Processar recomendações para todos os fixtures
 * @param {Array} fixtures - Array de fixtures
 * @param {Array} allOdds - Array de todas as odds
 * @returns {Promise<Array>} Array de recomendações
 */
async function processRecommendations(fixtures, allOdds) {
  const allRecommendations = [];

  for (const fixture of fixtures) {
    try {
      // Validar dados do fixture
      if (!validateMatchData(fixture)) {
        console.warn(`⚠️ Dados inválidos para fixture ${fixture.api_fixture_id}`);
        continue;
      }

      // Buscar odds específicas deste fixture
      const fixtureOdds = allOdds.filter(odd => 
        odd.api_fixture_id === fixture.api_fixture_id
      );

      if (fixtureOdds.length === 0) {
        console.warn(`⚠️ Nenhuma odd encontrada para fixture ${fixture.api_fixture_id}`);
        continue;
      }

      // Gerar recomendações usando o modelo Poisson
      const recommendations = generateRecommendations(fixture, fixtureOdds);
      
      if (recommendations.length > 0) {
        allRecommendations.push(...recommendations);
        console.log(`✅ ${recommendations.length} recomendações para ${fixture.home_team} vs ${fixture.away_team}`);
      }

    } catch (error) {
      console.error(`❌ Erro ao processar fixture ${fixture.api_fixture_id}:`, error.message);
    }
  }

  return allRecommendations;
}

/**
 * Enriquecer odds com fixture_id do banco de dados
 * @param {Array} odds - Array de odds
 * @param {Array} fixtures - Array de fixtures salvos
 * @returns {Array} Odds enriquecidas
 */
async function enrichOddsWithFixtureIds(odds, fixtures) {
  const fixtureMap = new Map();
  fixtures.forEach(fixture => {
    fixtureMap.set(fixture.api_fixture_id, fixture.id);
  });

  return odds.map(odd => ({
    ...odd,
    fixture_id: fixtureMap.get(odd.api_fixture_id)
  })).filter(odd => odd.fixture_id); // Remover odds sem fixture_id
}

/**
 * Gerar Top Picks do dia
 * @returns {Promise<Array>} Array de top picks
 */
async function generateTopPicks() {
  try {
    // Buscar top 10 recomendações com edge >= 2%
    const topRecommendations = await getTopRecommendations(10, 2);

    return topRecommendations.map(rec => ({
      id: rec.id,
      fixture: {
        home_team: rec.fixtures.home_team,
        away_team: rec.fixtures.away_team,
        date: rec.fixtures.date,
        league_name: rec.fixtures.league_name,
        country: rec.fixtures.country
      },
      market: {
        type: rec.market_type,
        value: rec.market_value,
        selection: rec.selection,
        display: formatMarketDisplay(rec.market_type, rec.market_value, rec.selection)
      },
      prediction: {
        probability: rec.predicted_probability,
        fairOdd: rec.fair_odd,
        marketOdd: rec.best_market_odd,
        edge: rec.edge_percentage,
        confidence: rec.confidence_score
      },
      explanation: rec.explanation,
      recommendation: getRecommendationLevel(rec.edge_percentage),
      createdAt: rec.created_at
    }));

  } catch (error) {
    console.error('Erro ao gerar top picks:', error);
    return [];
  }
}

/**
 * Formatar display do mercado para o usuário
 * @param {string} marketType - Tipo do mercado
 * @param {string} marketValue - Valor do mercado
 * @param {string} selection - Seleção
 * @returns {string} Display formatado
 */
function formatMarketDisplay(marketType, marketValue, selection) {
  if (marketType === 'over_under_goals') {
    const selectionText = selection === 'over' ? 'Mais de' : 'Menos de';
    return `${selectionText} ${marketValue} gols`;
  }
  
  return `${selection} ${marketValue}`;
}

/**
 * Determinar nível de recomendação baseado no edge
 * @param {number} edge - Percentual de edge
 * @returns {string} Nível da recomendação
 */
function getRecommendationLevel(edge) {
  if (edge >= 5) return 'Forte';
  if (edge >= 3) return 'Moderada';
  if (edge >= 1) return 'Fraca';
  return 'Evitar';
}

/**
 * Executar processamento de teste (para desenvolvimento)
 * @returns {Promise<Object>} Resultado do teste
 */
export async function runTestProcessing() {
  try {
    console.log('🧪 Executando processamento de teste...');
    
    // Testar APIs
    const apiStatus = await testApiConnectivity();
    console.log('APIs:', apiStatus);

    // Buscar alguns fixtures
    const fixtures = await fetchUpcomingFixtures();
    console.log(`Fixtures encontrados: ${fixtures.length}`);

    if (fixtures.length > 0) {
      // Testar com apenas os primeiros 2 fixtures
      const testFixtures = fixtures.slice(0, 2);
      const odds = await fetchMultipleFixturesOdds(testFixtures);
      console.log(`Odds coletadas: ${odds.length}`);

      // Testar modelo
      if (odds.length > 0) {
        const recommendations = await processRecommendations(testFixtures, odds);
        console.log(`Recomendações geradas: ${recommendations.length}`);
      }
    }

    return { success: true, message: 'Teste concluído' };
    
  } catch (error) {
    console.error('Erro no teste:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Função para executar apenas a atualização de odds (sem reprocessar tudo)
 * @returns {Promise<Object>} Resultado da atualização
 */
export async function updateOddsOnly() {
  try {
    console.log('📊 Atualizando apenas odds...');
    
    const fixtures = await fetchUpcomingFixtures();
    if (fixtures.length === 0) {
      return { success: true, message: 'Nenhum jogo para atualizar' };
    }

    const odds = await fetchMultipleFixturesOdds(fixtures);
    
    if (odds.length > 0) {
      const enrichedOdds = await enrichOddsWithFixtureIds(odds, fixtures);
      await insertOddsSnapshots(enrichedOdds);
    }

    return { 
      success: true, 
      oddsUpdated: odds.length,
      fixturesChecked: fixtures.length 
    };
    
  } catch (error) {
    console.error('Erro ao atualizar odds:', error);
    return { success: false, error: error.message };
  }
}
