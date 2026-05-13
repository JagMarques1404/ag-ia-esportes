-- ============================================================
-- AG IA Esportes — MVP Fase 1
-- Schema inicial do banco de dados
-- Rode este SQL no SQL Editor do Supabase
-- ============================================================

-- Habilitar extensões
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABELA: framework_settings
-- Regras de gestão de banca por usuário
-- ============================================================
CREATE TABLE IF NOT EXISTS framework_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Limites de stake
  max_stake_pct NUMERIC(5,2) DEFAULT 5.00 CHECK (max_stake_pct BETWEEN 1 AND 20),
  daily_limit_pct NUMERIC(5,2) DEFAULT 12.00 CHECK (daily_limit_pct BETWEEN 3 AND 30),
  
  -- Stops
  stop_loss_pct NUMERIC(5,2) DEFAULT 10.00 CHECK (stop_loss_pct BETWEEN 5 AND 25),
  stop_win_pct NUMERIC(5,2) DEFAULT 25.00 CHECK (stop_win_pct BETWEEN 10 AND 50),
  
  -- Timeouts
  timeout_after_losses INT DEFAULT 3,
  timeout_minutes INT DEFAULT 30,
  block_after_stop_loss_hours INT DEFAULT 24,
  
  -- Limites de quantidade
  max_bets_per_day INT DEFAULT 5,
  
  -- Modo de proteção
  protection_mode TEXT DEFAULT 'normal' CHECK (protection_mode IN ('normal', 'strict', 'paused')),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABELA: bankroll
-- Estado atual da banca de cada usuário
-- ============================================================
CREATE TABLE IF NOT EXISTS bankroll (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  
  current_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  starting_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  
  -- Acumulado
  total_deposited NUMERIC(12,2) DEFAULT 0,
  total_withdrawn NUMERIC(12,2) DEFAULT 0,
  total_staked NUMERIC(12,2) DEFAULT 0,
  total_returned NUMERIC(12,2) DEFAULT 0,
  
  -- Tracking de bloqueios
  blocked_until TIMESTAMPTZ,
  block_reason TEXT,
  
  -- Estatísticas básicas
  current_streak_type TEXT CHECK (current_streak_type IN ('win', 'loss', 'none')) DEFAULT 'none',
  current_streak_count INT DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABELA: bankroll_log
-- Histórico de todas as movimentações
-- ============================================================
CREATE TABLE IF NOT EXISTS bankroll_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  type TEXT NOT NULL CHECK (type IN (
    'deposit', 'withdraw', 'bet_loss', 'bet_win', 'cashout', 'adjustment'
  )),
  
  amount NUMERIC(12,2) NOT NULL,
  balance_after NUMERIC(12,2) NOT NULL,
  
  reference_id UUID, -- bet_id se aplicável
  description TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bankroll_log_user_date ON bankroll_log(user_id, created_at DESC);

-- ============================================================
-- TABELA: bets
-- Apostas registradas pelo usuário
-- ============================================================
CREATE TABLE IF NOT EXISTS bets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Tipo de aposta
  bet_type TEXT NOT NULL CHECK (bet_type IN ('single', 'multiple', 'system')),
  tier TEXT NOT NULL CHECK (tier IN ('segura', 'intermediaria', 'avancada', 'mega_sena', 'dobra_do_dia')),
  
  -- Dados financeiros
  total_stake NUMERIC(12,2) NOT NULL CHECK (total_stake > 0),
  combined_odd NUMERIC(8,2) NOT NULL CHECK (combined_odd >= 1.01),
  potential_return NUMERIC(12,2) NOT NULL,
  
  -- Análise (manual no MVP)
  estimated_prob_pct NUMERIC(5,2), -- 0 a 100
  estimated_ev_pct NUMERIC(7,2),   -- pode ser negativo
  
  -- Metadados
  bookmaker TEXT, -- bet365, betano, etc
  bookmaker_bet_id TEXT,
  notes TEXT,
  
  -- Status e resultado
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
    'open', 'won', 'lost', 'cashed_out', 'void', 'partial'
  )),
  result_value NUMERIC(12,2) DEFAULT 0, -- quanto retornou
  
  placed_at TIMESTAMPTZ DEFAULT NOW(),
  settled_at TIMESTAMPTZ,
  
  -- Flags
  was_recommended BOOLEAN DEFAULT FALSE, -- IA recomendou?
  followed_framework BOOLEAN DEFAULT TRUE, -- ficou dentro do framework?
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bets_user_status ON bets(user_id, status);
CREATE INDEX idx_bets_user_date ON bets(user_id, placed_at DESC);
CREATE INDEX idx_bets_user_tier ON bets(user_id, tier);

-- ============================================================
-- TABELA: bet_legs
-- Pernas individuais das múltiplas
-- ============================================================
CREATE TABLE IF NOT EXISTS bet_legs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bet_id UUID NOT NULL REFERENCES bets(id) ON DELETE CASCADE,
  
  -- Identificação do jogo
  competition TEXT NOT NULL, -- "Brasileirão", "Premier League"
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  game_date TIMESTAMPTZ,
  
  -- Mercado e seleção
  market_type TEXT NOT NULL, -- "Resultado", "Mais de 2.5 gols", "BTTS", etc
  selection TEXT NOT NULL,    -- valor específico
  
  -- Odd e probabilidade
  odd_value NUMERIC(8,2) NOT NULL CHECK (odd_value >= 1.01),
  estimated_prob_pct NUMERIC(5,2),
  
  -- Resultado
  result TEXT CHECK (result IN ('pending', 'won', 'lost', 'void', 'half_won', 'half_lost')) DEFAULT 'pending',
  
  -- Posição na múltipla (ordem)
  position INT DEFAULT 1,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bet_legs_bet_id ON bet_legs(bet_id);

-- ============================================================
-- TABELA: daily_summaries
-- Resumos diários pré-calculados (para performance)
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_summaries (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  summary_date DATE NOT NULL,
  
  bets_placed INT DEFAULT 0,
  bets_won INT DEFAULT 0,
  bets_lost INT DEFAULT 0,
  bets_open INT DEFAULT 0,
  
  total_stake NUMERIC(12,2) DEFAULT 0,
  total_return NUMERIC(12,2) DEFAULT 0,
  net_pnl NUMERIC(12,2) DEFAULT 0,
  roi_pct NUMERIC(7,2) DEFAULT 0,
  
  starting_balance NUMERIC(12,2),
  ending_balance NUMERIC(12,2),
  
  -- Framework
  stop_loss_triggered BOOLEAN DEFAULT FALSE,
  stop_win_triggered BOOLEAN DEFAULT FALSE,
  framework_violations INT DEFAULT 0,
  
  -- Comportamental
  tilt_score INT, -- 0-100
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  PRIMARY KEY (user_id, summary_date)
);

-- ============================================================
-- VIEWS úteis para dashboard
-- ============================================================

-- ROI por liga
CREATE OR REPLACE VIEW vw_roi_by_competition AS
SELECT 
  b.user_id,
  bl.competition,
  COUNT(DISTINCT b.id) AS total_bets,
  COUNT(DISTINCT b.id) FILTER (WHERE b.status = 'won') AS bets_won,
  COUNT(DISTINCT b.id) FILTER (WHERE b.status = 'lost') AS bets_lost,
  COALESCE(SUM(b.total_stake), 0) AS total_staked,
  COALESCE(SUM(b.result_value), 0) AS total_returned,
  COALESCE(SUM(b.result_value) - SUM(b.total_stake), 0) AS net_pnl,
  CASE 
    WHEN SUM(b.total_stake) > 0 
    THEN ROUND(((SUM(b.result_value) - SUM(b.total_stake)) / SUM(b.total_stake) * 100)::numeric, 2)
    ELSE 0 
  END AS roi_pct
FROM bets b
JOIN bet_legs bl ON bl.bet_id = b.id
WHERE b.status IN ('won', 'lost', 'cashed_out')
GROUP BY b.user_id, bl.competition;

-- ROI por mercado
CREATE OR REPLACE VIEW vw_roi_by_market AS
SELECT 
  b.user_id,
  bl.market_type,
  COUNT(DISTINCT b.id) AS total_bets,
  COUNT(DISTINCT b.id) FILTER (WHERE b.status = 'won') AS bets_won,
  COALESCE(SUM(b.total_stake), 0) AS total_staked,
  COALESCE(SUM(b.result_value), 0) AS total_returned,
  COALESCE(SUM(b.result_value) - SUM(b.total_stake), 0) AS net_pnl,
  CASE 
    WHEN SUM(b.total_stake) > 0 
    THEN ROUND(((SUM(b.result_value) - SUM(b.total_stake)) / SUM(b.total_stake) * 100)::numeric, 2)
    ELSE 0 
  END AS roi_pct
FROM bets b
JOIN bet_legs bl ON bl.bet_id = b.id
WHERE b.status IN ('won', 'lost', 'cashed_out')
GROUP BY b.user_id, bl.market_type;

-- ROI por tier
CREATE OR REPLACE VIEW vw_roi_by_tier AS
SELECT 
  user_id,
  tier,
  COUNT(*) AS total_bets,
  COUNT(*) FILTER (WHERE status = 'won') AS bets_won,
  COUNT(*) FILTER (WHERE status = 'lost') AS bets_lost,
  COALESCE(SUM(total_stake), 0) AS total_staked,
  COALESCE(SUM(result_value), 0) AS total_returned,
  COALESCE(SUM(result_value) - SUM(total_stake), 0) AS net_pnl,
  CASE 
    WHEN SUM(total_stake) > 0 
    THEN ROUND(((SUM(result_value) - SUM(total_stake)) / SUM(total_stake) * 100)::numeric, 2)
    ELSE 0 
  END AS roi_pct
FROM bets
WHERE status IN ('won', 'lost', 'cashed_out')
GROUP BY user_id, tier;

-- Dashboard consolidado
CREATE OR REPLACE VIEW vw_user_dashboard AS
SELECT 
  br.user_id,
  br.current_balance,
  br.starting_balance,
  br.total_deposited,
  br.total_staked,
  br.total_returned,
  br.current_streak_type,
  br.current_streak_count,
  br.blocked_until,
  
  -- ROI total
  CASE 
    WHEN br.total_staked > 0 
    THEN ROUND(((br.total_returned - br.total_staked) / br.total_staked * 100)::numeric, 2)
    ELSE 0 
  END AS lifetime_roi_pct,
  
  -- Lucro líquido total
  (br.total_returned - br.total_staked) AS lifetime_pnl,
  
  -- Hoje
  COALESCE(today.bets_placed, 0) AS bets_today,
  COALESCE(today.total_stake, 0) AS staked_today,
  COALESCE(today.net_pnl, 0) AS pnl_today,
  COALESCE(today.roi_pct, 0) AS roi_today,
  
  -- Apostas abertas
  COALESCE(open_bets.count, 0) AS open_bets_count,
  COALESCE(open_bets.total_stake, 0) AS open_bets_stake
  
FROM bankroll br
LEFT JOIN daily_summaries today ON today.user_id = br.user_id AND today.summary_date = CURRENT_DATE
LEFT JOIN (
  SELECT user_id, COUNT(*) as count, SUM(total_stake) as total_stake
  FROM bets WHERE status = 'open' GROUP BY user_id
) open_bets ON open_bets.user_id = br.user_id;

-- ============================================================
-- RLS (Row Level Security)
-- ============================================================

ALTER TABLE framework_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bankroll ENABLE ROW LEVEL SECURITY;
ALTER TABLE bankroll_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE bet_legs ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_summaries ENABLE ROW LEVEL SECURITY;

-- Policies: usuário só vê os próprios dados
CREATE POLICY "users_own_framework" ON framework_settings
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "users_own_bankroll" ON bankroll
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "users_own_bankroll_log" ON bankroll_log
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "users_own_bets" ON bets
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "users_own_bet_legs" ON bet_legs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM bets 
      WHERE bets.id = bet_legs.bet_id AND bets.user_id = auth.uid()
    )
  );

CREATE POLICY "users_own_summaries" ON daily_summaries
  FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- TRIGGERS para automação
-- ============================================================

-- Função: criar bankroll e framework_settings ao criar usuário
CREATE OR REPLACE FUNCTION init_user_data()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO bankroll (user_id, current_balance, starting_balance)
  VALUES (NEW.id, 0, 0);
  
  INSERT INTO framework_settings (user_id)
  VALUES (NEW.id);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger no auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION init_user_data();

-- Função: atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_bankroll_updated_at BEFORE UPDATE ON bankroll
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_bets_updated_at BEFORE UPDATE ON bets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_framework_updated_at BEFORE UPDATE ON framework_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
