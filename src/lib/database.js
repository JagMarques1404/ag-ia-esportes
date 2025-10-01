/**
 * AG IA ESPORTES - Serviços de Banco de Dados
 * Operações CRUD para todas as tabelas do sistema
 */

import { supabase } from './supabase.js';

/**
 * FIXTURES (Jogos)
 */

// Inserir ou atualizar fixtures
export async function upsertFixtures(fixtures) {
  try {
    const { data, error } = await supabase
      .from('fixtures')
      .upsert(fixtures, { 
        onConflict: 'api_fixture_id',
        ignoreDuplicates: false 
      })
      .select();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Erro ao inserir fixtures:', error);
    throw error;
  }
}

// Buscar fixtures por data
export async function getFixturesByDate(date) {
  try {
    const startDate = new Date(date);
    const endDate = new Date(date);
    endDate.setDate(endDate.getDate() + 1);

    const { data, error } = await supabase
      .from('fixtures')
      .select('*')
      .gte('date', startDate.toISOString())
      .lt('date', endDate.toISOString())
      .order('date', { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Erro ao buscar fixtures por data:', error);
    throw error;
  }
}

// Buscar fixtures das próximas 72 horas
export async function getUpcomingFixtures() {
  try {
    const now = new Date();
    const in72Hours = new Date(now.getTime() + (72 * 60 * 60 * 1000));

    const { data, error } = await supabase
      .from('fixtures')
      .select('*')
      .gte('date', now.toISOString())
      .lte('date', in72Hours.toISOString())
      .eq('status', 'scheduled')
      .order('date', { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Erro ao buscar fixtures próximos:', error);
    throw error;
  }
}

/**
 * ODDS SNAPSHOTS
 */

// Inserir odds capturadas
export async function insertOddsSnapshots(odds) {
  try {
    const { data, error } = await supabase
      .from('odds_snapshots')
      .insert(odds)
      .select();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Erro ao inserir odds:', error);
    throw error;
  }
}

// Buscar odds mais recentes para um fixture
export async function getLatestOddsForFixture(fixtureId) {
  try {
    const { data, error } = await supabase
      .from('odds_snapshots')
      .select('*')
      .eq('fixture_id', fixtureId)
      .order('captured_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Erro ao buscar odds do fixture:', error);
    throw error;
  }
}

/**
 * RECOMMENDATIONS (Recomendações)
 */

// Inserir recomendações
export async function insertRecommendations(recommendations) {
  try {
    const { data, error } = await supabase
      .from('recommendations')
      .upsert(recommendations, {
        onConflict: 'fixture_id,market_type,market_value,selection',
        ignoreDuplicates: false
      })
      .select();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Erro ao inserir recomendações:', error);
    throw error;
  }
}

// Buscar top recomendações por edge
export async function getTopRecommendations(limit = 10, minEdge = 2) {
  try {
    const { data, error } = await supabase
      .from('recommendations')
      .select(`
        *,
        fixtures (
          home_team,
          away_team,
          date,
          league_name,
          country
        )
      `)
      .gte('edge_percentage', minEdge)
      .order('edge_percentage', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Erro ao buscar top recomendações:', error);
    throw error;
  }
}

// Buscar recomendações por fixture
export async function getRecommendationsByFixture(fixtureId) {
  try {
    const { data, error } = await supabase
      .from('recommendations')
      .select(`
        *,
        fixtures (
          home_team,
          away_team,
          date,
          league_name,
          country
        )
      `)
      .eq('fixture_id', fixtureId)
      .order('edge_percentage', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Erro ao buscar recomendações do fixture:', error);
    throw error;
  }
}

/**
 * DAILY PUBLICATIONS (Publicações Diárias)
 */

// Salvar publicação diária
export async function saveDailyPublication(publicationDate, publicationType, content) {
  try {
    const { data, error } = await supabase
      .from('daily_publications')
      .upsert({
        publication_date: publicationDate,
        publication_type: publicationType,
        content: content
      }, {
        onConflict: 'publication_date,publication_type',
        ignoreDuplicates: false
      })
      .select();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Erro ao salvar publicação diária:', error);
    throw error;
  }
}

// Buscar publicação do dia
export async function getTodayPublication(publicationType = 'top_picks') {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    const { data, error } = await supabase
      .from('daily_publications')
      .select('*')
      .eq('publication_date', today)
      .eq('publication_type', publicationType)
      .single();

    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
    return data;
  } catch (error) {
    console.error('Erro ao buscar publicação do dia:', error);
    return null;
  }
}

/**
 * MODEL RUNS (Execuções do Modelo)
 */

// Iniciar execução do modelo
export async function startModelRun(modelVersion) {
  try {
    const { data, error } = await supabase
      .from('model_runs')
      .insert({
        run_date: new Date().toISOString().split('T')[0],
        model_version: modelVersion,
        status: 'running'
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Erro ao iniciar execução do modelo:', error);
    throw error;
  }
}

// Finalizar execução do modelo
export async function completeModelRun(runId, stats) {
  try {
    const { data, error } = await supabase
      .from('model_runs')
      .update({
        fixtures_processed: stats.fixturesProcessed,
        recommendations_generated: stats.recommendationsGenerated,
        execution_time_seconds: stats.executionTimeSeconds,
        status: 'completed',
        completed_at: new Date().toISOString(),
        calibration_metrics: stats.calibrationMetrics || null
      })
      .eq('id', runId)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Erro ao finalizar execução do modelo:', error);
    throw error;
  }
}

// Marcar execução como falha
export async function failModelRun(runId, errorMessage) {
  try {
    const { data, error } = await supabase
      .from('model_runs')
      .update({
        status: 'failed',
        error_message: errorMessage,
        completed_at: new Date().toISOString()
      })
      .eq('id', runId)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Erro ao marcar falha na execução:', error);
    throw error;
  }
}

/**
 * FUNÇÕES UTILITÁRIAS
 */

// Buscar fixture por API ID
export async function getFixtureByApiId(apiFixtureId) {
  try {
    const { data, error } = await supabase
      .from('fixtures')
      .select('*')
      .eq('api_fixture_id', apiFixtureId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  } catch (error) {
    console.error('Erro ao buscar fixture por API ID:', error);
    return null;
  }
}

// Limpar dados antigos (manutenção)
export async function cleanOldData(daysToKeep = 30) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const cutoffIso = cutoffDate.toISOString();

    // Limpar odds antigas
    const { error: oddsError } = await supabase
      .from('odds_snapshots')
      .delete()
      .lt('captured_at', cutoffIso);

    if (oddsError) throw oddsError;

    // Limpar model runs antigos
    const { error: runsError } = await supabase
      .from('model_runs')
      .delete()
      .lt('created_at', cutoffIso);

    if (runsError) throw runsError;

    console.log(`Dados anteriores a ${cutoffDate.toDateString()} foram removidos`);
  } catch (error) {
    console.error('Erro ao limpar dados antigos:', error);
    throw error;
  }
}

// Verificar saúde do banco de dados
export async function checkDatabaseHealth() {
  try {
    const checks = {
      fixtures: false,
      odds: false,
      recommendations: false,
      publications: false,
      modelRuns: false
    };

    // Testar cada tabela
    const { data: fixtures } = await supabase.from('fixtures').select('id').limit(1);
    checks.fixtures = fixtures !== null;

    const { data: odds } = await supabase.from('odds_snapshots').select('id').limit(1);
    checks.odds = odds !== null;

    const { data: recommendations } = await supabase.from('recommendations').select('id').limit(1);
    checks.recommendations = recommendations !== null;

    const { data: publications } = await supabase.from('daily_publications').select('id').limit(1);
    checks.publications = publications !== null;

    const { data: modelRuns } = await supabase.from('model_runs').select('id').limit(1);
    checks.modelRuns = modelRuns !== null;

    return checks;
  } catch (error) {
    console.error('Erro ao verificar saúde do banco:', error);
    return null;
  }
}
