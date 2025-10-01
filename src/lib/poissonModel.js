/**
 * AG IA ESPORTES - Modelo Poisson para Gols
 * Implementação simplificada do modelo Poisson bivariado para MVP
 */

// Função para calcular a probabilidade de Poisson
function poissonProbability(lambda, k) {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

// Função para calcular fatorial
function factorial(n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}

// Função para calcular probabilidade cumulativa de Poisson
function poissonCumulative(lambda, k, isOver = true) {
  let prob = 0;
  if (isOver) {
    // P(X > k) = 1 - P(X <= k)
    for (let i = 0; i <= k; i++) {
      prob += poissonProbability(lambda, i);
    }
    return 1 - prob;
  } else {
    // P(X <= k)
    for (let i = 0; i <= k; i++) {
      prob += poissonProbability(lambda, i);
    }
    return prob;
  }
}

/**
 * Modelo Poisson Bivariado Simplificado
 * @param {Object} matchData - Dados do jogo
 * @param {string} matchData.homeTeam - Nome do time da casa
 * @param {string} matchData.awayTeam - Nome do time visitante
 * @param {number} matchData.homeTeamId - ID do time da casa
 * @param {number} matchData.awayTeamId - ID do time visitante
 * @param {string} matchData.league - Liga do jogo
 * @returns {Object} Probabilidades calculadas
 */
export function calculateMatchProbabilities(matchData) {
  // Para o MVP, usaremos valores base ajustados por fatores simples
  // Em produção, estes valores viriam de análise histórica e xG
  
  // Média de gols base por liga (valores aproximados)
  const leagueGoalAverages = {
    'Premier League': 2.7,
    'La Liga': 2.6,
    'Serie A': 2.5,
    'Bundesliga': 3.1,
    'Ligue 1': 2.8,
    'Brasileirão': 2.4,
    'Copa do Brasil': 2.3,
    'Libertadores': 2.2,
    'default': 2.5
  };

  // Fator de mando de campo (casa tem vantagem)
  const homeAdvantage = 1.15;
  const awayDisadvantage = 0.85;

  // Média de gols base da liga
  const leagueAvg = leagueGoalAverages[matchData.league] || leagueGoalAverages.default;

  // Lambdas ajustados (em produção, viriam de análise de forma, xG, etc.)
  const lambdaHome = leagueAvg * homeAdvantage * 0.55; // ~55% dos gols para o mandante
  const lambdaAway = leagueAvg * awayDisadvantage * 0.45; // ~45% dos gols para o visitante

  // Calcular probabilidades para diferentes mercados de gols
  const probabilities = {
    // Over/Under 1.5 gols
    over_1_5: 1 - poissonProbability(lambdaHome + lambdaAway, 0) - poissonProbability(lambdaHome + lambdaAway, 1),
    under_1_5: poissonProbability(lambdaHome + lambdaAway, 0) + poissonProbability(lambdaHome + lambdaAway, 1),
    
    // Over/Under 2.5 gols
    over_2_5: poissonCumulative(lambdaHome + lambdaAway, 2, true),
    under_2_5: poissonCumulative(lambdaHome + lambdaAway, 2, false),
    
    // Over/Under 3.5 gols
    over_3_5: poissonCumulative(lambdaHome + lambdaAway, 3, true),
    under_3_5: poissonCumulative(lambdaHome + lambdaAway, 3, false),

    // Dados do modelo
    lambdaHome,
    lambdaAway,
    totalGoalsExpected: lambdaHome + lambdaAway
  };

  return probabilities;
}

/**
 * Calcular o Edge (valor) de uma aposta
 * @param {number} predictedProbability - Probabilidade prevista pelo modelo (0-1)
 * @param {number} marketOdd - Odd oferecida pelo mercado
 * @returns {Object} Dados do edge
 */
export function calculateEdge(predictedProbability, marketOdd) {
  const fairOdd = 1 / predictedProbability;
  const edge = (marketOdd / fairOdd - 1) * 100;
  
  return {
    predictedProbability: Math.round(predictedProbability * 10000) / 10000, // 4 casas decimais
    fairOdd: Math.round(fairOdd * 100) / 100, // 2 casas decimais
    marketOdd,
    edgePercentage: Math.round(edge * 100) / 100, // 2 casas decimais
    hasValue: edge > 0,
    recommendation: edge > 2 ? 'strong' : edge > 0 ? 'weak' : 'avoid'
  };
}

/**
 * Gerar recomendações para um jogo
 * @param {Object} matchData - Dados do jogo
 * @param {Array} oddsData - Array de odds do mercado
 * @returns {Array} Array de recomendações
 */
export function generateRecommendations(matchData, oddsData) {
  const probabilities = calculateMatchProbabilities(matchData);
  const recommendations = [];

  // Mapear mercados de odds para probabilidades calculadas
  const marketMap = {
    'over_1_5': probabilities.over_1_5,
    'under_1_5': probabilities.under_1_5,
    'over_2_5': probabilities.over_2_5,
    'under_2_5': probabilities.under_2_5,
    'over_3_5': probabilities.over_3_5,
    'under_3_5': probabilities.under_3_5
  };

  // Processar cada odd disponível
  oddsData.forEach(odd => {
    const marketKey = `${odd.selection}_${odd.market_value}`;
    const predictedProb = marketMap[marketKey];

    if (predictedProb) {
      const edgeData = calculateEdge(predictedProb, odd.odd_value);
      
      if (edgeData.hasValue) {
        recommendations.push({
          fixture_id: matchData.fixture_id,
          api_fixture_id: matchData.api_fixture_id,
          market_type: 'over_under_goals',
          market_value: odd.market_value,
          selection: odd.selection,
          predicted_probability: edgeData.predictedProbability,
          fair_odd: edgeData.fairOdd,
          best_market_odd: edgeData.marketOdd,
          edge_percentage: edgeData.edgePercentage,
          confidence_score: 0.7, // Score base para o MVP
          model_version: 'poisson_v1',
          explanation: generateExplanation(matchData, odd, edgeData, probabilities)
        });
      }
    }
  });

  // Ordenar por edge decrescente
  return recommendations.sort((a, b) => b.edge_percentage - a.edge_percentage);
}

/**
 * Gerar explicação textual para a recomendação
 * @param {Object} matchData - Dados do jogo
 * @param {Object} odd - Dados da odd
 * @param {Object} edgeData - Dados do edge
 * @param {Object} probabilities - Probabilidades calculadas
 * @returns {string} Explicação textual
 */
function generateExplanation(matchData, odd, edgeData, probabilities) {
  const totalGoals = Math.round(probabilities.totalGoalsExpected * 10) / 10;
  const homeGoals = Math.round(probabilities.lambdaHome * 10) / 10;
  const awayGoals = Math.round(probabilities.lambdaAway * 10) / 10;

  let explanation = `Modelo prevê ${totalGoals} gols totais (${homeGoals} casa, ${awayGoals} fora). `;
  explanation += `Probabilidade de ${odd.selection} ${odd.market_value}: ${Math.round(edgeData.predictedProbability * 100)}%. `;
  explanation += `Odd justa: ${edgeData.fairOdd}, mercado oferece: ${edgeData.marketOdd}. `;
  explanation += `Edge de ${edgeData.edgePercentage}%.`;

  return explanation;
}

/**
 * Função utilitária para validar dados de entrada
 * @param {Object} matchData - Dados do jogo
 * @returns {boolean} Se os dados são válidos
 */
export function validateMatchData(matchData) {
  const required = ['homeTeam', 'awayTeam', 'fixture_id', 'api_fixture_id'];
  return required.every(field => matchData[field] !== undefined && matchData[field] !== null);
}
