-- ============================================================
-- AG IA Esportes — Migration 002
-- Fase 0: saneamento da base
--   1) Adiciona 'bet_placed' ao CHECK de bankroll_log.type
--   2) Função + trigger que sincroniza daily_summaries com bets
--   3) Backfill dos summaries existentes
-- Rode este SQL no SQL Editor do Supabase, depois do 001_init.sql.
-- ============================================================


-- ============================================================
-- 1) bankroll_log.type: novo valor 'bet_placed'
--    Motivo: ao registrar uma aposta ainda em aberto, gravávamos
--    type='bet_loss', o que é semanticamente errado — a aposta
--    pode ainda ser ganha/cashed_out. O novo tipo representa
--    o débito imediato da stake sem rotular como perda.
-- ============================================================
ALTER TABLE bankroll_log
  DROP CONSTRAINT IF EXISTS bankroll_log_type_check;

ALTER TABLE bankroll_log
  ADD CONSTRAINT bankroll_log_type_check CHECK (type IN (
    'deposit',
    'withdraw',
    'bet_placed',
    'bet_loss',
    'bet_win',
    'cashout',
    'adjustment'
  ));


-- ============================================================
-- 2) sync_daily_summary: recalcula o registro de daily_summaries
--    para a data e usuário afetados pela mudança em bets.
--    Estratégia: agregado completo do dia (idempotente, robusto
--    contra reordenação de eventos). Usa UPSERT em (user_id, date).
-- ============================================================
CREATE OR REPLACE FUNCTION sync_daily_summary_for(
  p_user_id UUID,
  p_date DATE
) RETURNS VOID AS $$
BEGIN
  INSERT INTO daily_summaries (
    user_id, summary_date,
    bets_placed, bets_won, bets_lost, bets_open,
    total_stake, total_return, net_pnl, roi_pct
  )
  SELECT
    p_user_id,
    p_date,
    COUNT(*)::int                                                  AS bets_placed,
    COUNT(*) FILTER (WHERE status = 'won')::int                    AS bets_won,
    COUNT(*) FILTER (WHERE status = 'lost')::int                   AS bets_lost,
    COUNT(*) FILTER (WHERE status = 'open')::int                   AS bets_open,
    COALESCE(SUM(total_stake), 0)                                  AS total_stake,
    COALESCE(SUM(result_value), 0)                                 AS total_return,
    COALESCE(
      SUM(result_value) FILTER (WHERE status IN ('won','lost','cashed_out'))
      - SUM(total_stake) FILTER (WHERE status IN ('won','lost','cashed_out')),
      0
    )                                                              AS net_pnl,
    CASE
      WHEN COALESCE(SUM(total_stake) FILTER (WHERE status IN ('won','lost','cashed_out')), 0) > 0
      THEN ROUND(
        ((SUM(result_value) FILTER (WHERE status IN ('won','lost','cashed_out'))
          - SUM(total_stake) FILTER (WHERE status IN ('won','lost','cashed_out')))
         / SUM(total_stake) FILTER (WHERE status IN ('won','lost','cashed_out')) * 100)::numeric,
        2
      )
      ELSE 0
    END                                                            AS roi_pct
  FROM bets
  WHERE user_id = p_user_id
    AND (placed_at)::date = p_date
  ON CONFLICT (user_id, summary_date) DO UPDATE SET
    bets_placed  = EXCLUDED.bets_placed,
    bets_won     = EXCLUDED.bets_won,
    bets_lost    = EXCLUDED.bets_lost,
    bets_open    = EXCLUDED.bets_open,
    total_stake  = EXCLUDED.total_stake,
    total_return = EXCLUDED.total_return,
    net_pnl      = EXCLUDED.net_pnl,
    roi_pct      = EXCLUDED.roi_pct,
    updated_at   = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Trigger function: chama sync para a(s) data(s) afetada(s)
CREATE OR REPLACE FUNCTION trg_sync_daily_summary()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM sync_daily_summary_for(OLD.user_id, (OLD.placed_at)::date);
    RETURN OLD;
  END IF;

  -- INSERT ou UPDATE
  PERFORM sync_daily_summary_for(NEW.user_id, (NEW.placed_at)::date);

  -- Caso raro: placed_at foi alterada para outra data → recalcula a data antiga também
  IF TG_OP = 'UPDATE' AND (OLD.placed_at)::date <> (NEW.placed_at)::date THEN
    PERFORM sync_daily_summary_for(OLD.user_id, (OLD.placed_at)::date);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Garante idempotência ao re-rodar a migration
DROP TRIGGER IF EXISTS trg_bets_sync_daily_summary ON bets;
CREATE TRIGGER trg_bets_sync_daily_summary
  AFTER INSERT OR UPDATE OR DELETE ON bets
  FOR EACH ROW EXECUTE FUNCTION trg_sync_daily_summary();


-- ============================================================
-- 3) Backfill: recalcula daily_summaries para todas as
--    combinações (user_id, date) já presentes em bets.
-- ============================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT user_id, (placed_at)::date AS d FROM bets
  LOOP
    PERFORM sync_daily_summary_for(r.user_id, r.d);
  END LOOP;
END $$;
