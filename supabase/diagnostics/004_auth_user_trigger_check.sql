-- ============================================================
-- AG IA Esportes — Diagnóstico do trigger de signup
-- Rode no Supabase SQL Editor ANTES e DEPOIS da migration 004
-- para confirmar o estado.
-- ============================================================


-- 1) Triggers ativos em auth.users
--    Esperado APÓS a migration 004:
--      trigger_name = 'on_auth_user_created'
--      event_manipulation = 'INSERT'
--      action_statement contém 'public.init_user_data()'
SELECT
  trigger_name,
  event_manipulation,
  action_timing,
  action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'auth'
  AND event_object_table  = 'users';


-- 2) Colunas de bankroll e framework_settings
--    Confirma que as colunas referenciadas pela função
--    (user_id, current_balance, starting_balance) existem
--    e têm os defaults certos.
SELECT
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('bankroll', 'framework_settings')
ORDER BY table_name, ordinal_position;


-- 3) Definição atual da função init_user_data
--    Esperado APÓS migration 004:
--      - LANGUAGE plpgsql
--      - SECURITY DEFINER
--      - configuration: search_path=public, auth
--      - owner = postgres
SELECT
  n.nspname              AS schema,
  p.proname              AS function_name,
  pg_get_userbyid(p.proowner) AS owner,
  l.lanname              AS language,
  p.prosecdef            AS is_security_definer,
  p.proconfig            AS config_settings
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language  l ON l.oid = p.prolang
WHERE p.proname = 'init_user_data'
  AND n.nspname = 'public';


-- 4) Usuários em auth.users sem registros auxiliares
--    Esperado APÓS o backfill da 004: 0 linhas.
SELECT
  u.id,
  u.email,
  u.created_at,
  CASE WHEN b.user_id IS NULL THEN 'FALTA' ELSE 'ok' END AS bankroll_status,
  CASE WHEN f.user_id IS NULL THEN 'FALTA' ELSE 'ok' END AS framework_status
FROM auth.users u
LEFT JOIN public.bankroll          b ON b.user_id = u.id
LEFT JOIN public.framework_settings f ON f.user_id = u.id
WHERE b.user_id IS NULL OR f.user_id IS NULL
ORDER BY u.created_at DESC;
