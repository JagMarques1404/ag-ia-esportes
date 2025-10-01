-- AG IA ESPORTES - Database Schema
-- Tabelas para o MVP focado em mercado de gols

-- Tabela de fixtures (jogos)
CREATE TABLE IF NOT EXISTS fixtures (
    id BIGSERIAL PRIMARY KEY,
    api_fixture_id INTEGER UNIQUE NOT NULL,
    date TIMESTAMPTZ NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
    home_team VARCHAR(100) NOT NULL,
    away_team VARCHAR(100) NOT NULL,
    home_team_id INTEGER,
    away_team_id INTEGER,
    league_name VARCHAR(100),
    league_id INTEGER,
    country VARCHAR(50),
    season INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de odds snapshots
CREATE TABLE IF NOT EXISTS odds_snapshots (
    id BIGSERIAL PRIMARY KEY,
    fixture_id BIGINT REFERENCES fixtures(id) ON DELETE CASCADE,
    api_fixture_id INTEGER NOT NULL,
    bookmaker VARCHAR(50) NOT NULL,
    market_type VARCHAR(50) NOT NULL, -- 'over_under_goals', 'match_winner', etc
    market_value VARCHAR(20), -- '1.5', '2.5', '3.5' para over/under
    selection VARCHAR(50) NOT NULL, -- 'over', 'under', 'home', 'away', 'draw'
    odd_value DECIMAL(6,2) NOT NULL,
    captured_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de recomendações (resultado do modelo)
CREATE TABLE IF NOT EXISTS recommendations (
    id BIGSERIAL PRIMARY KEY,
    fixture_id BIGINT REFERENCES fixtures(id) ON DELETE CASCADE,
    api_fixture_id INTEGER NOT NULL,
    market_type VARCHAR(50) NOT NULL,
    market_value VARCHAR(20),
    selection VARCHAR(50) NOT NULL,
    predicted_probability DECIMAL(5,4) NOT NULL, -- 0.0000 a 1.0000
    fair_odd DECIMAL(6,2) NOT NULL, -- 1 / predicted_probability
    best_market_odd DECIMAL(6,2) NOT NULL,
    edge_percentage DECIMAL(5,2) NOT NULL, -- (market_odd / fair_odd - 1) * 100
    confidence_score DECIMAL(3,2) DEFAULT 0.5, -- 0.0 a 1.0
    model_version VARCHAR(20) DEFAULT 'poisson_v1',
    explanation TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de publicações diárias (Top Picks)
CREATE TABLE IF NOT EXISTS daily_publications (
    id BIGSERIAL PRIMARY KEY,
    publication_date DATE NOT NULL,
    publication_type VARCHAR(20) NOT NULL DEFAULT 'top_picks', -- 'top_picks', 'parlay'
    content JSONB NOT NULL, -- Array de picks com todos os dados
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(publication_date, publication_type)
);

-- Tabela de execuções do modelo (para monitoramento)
CREATE TABLE IF NOT EXISTS model_runs (
    id BIGSERIAL PRIMARY KEY,
    run_date DATE NOT NULL,
    model_version VARCHAR(20) NOT NULL,
    fixtures_processed INTEGER DEFAULT 0,
    recommendations_generated INTEGER DEFAULT 0,
    execution_time_seconds INTEGER,
    status VARCHAR(20) DEFAULT 'running', -- 'running', 'completed', 'failed'
    error_message TEXT,
    calibration_metrics JSONB, -- brier, logloss, etc
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_fixtures_date ON fixtures(date);
CREATE INDEX IF NOT EXISTS idx_fixtures_api_id ON fixtures(api_fixture_id);
CREATE INDEX IF NOT EXISTS idx_odds_fixture_id ON odds_snapshots(fixture_id);
CREATE INDEX IF NOT EXISTS idx_odds_market ON odds_snapshots(market_type, market_value);
CREATE INDEX IF NOT EXISTS idx_recommendations_fixture ON recommendations(fixture_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_edge ON recommendations(edge_percentage DESC);
CREATE INDEX IF NOT EXISTS idx_daily_publications_date ON daily_publications(publication_date);

-- Função para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers para updated_at
CREATE TRIGGER update_fixtures_updated_at BEFORE UPDATE ON fixtures
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_recommendations_updated_at BEFORE UPDATE ON recommendations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS (Row Level Security) - Desabilitado para o MVP
-- ALTER TABLE fixtures ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE odds_snapshots ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE recommendations ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE daily_publications ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE model_runs ENABLE ROW LEVEL SECURITY;
