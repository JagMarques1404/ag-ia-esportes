-- ============================================================
-- AG IA Esportes — Migration 004
-- Correção do trigger de criação de usuário (Auth signup)
--
-- Sintoma: "Database error saving new user" em /auth/signup.
-- Causa raiz mais provável da função init_user_data() criada
-- na 001:
--   1) Sem SET search_path → o role efetivo do trigger
--      (supabase_auth_admin) pode não resolver bankroll /
--      framework_settings para o schema public.
--   2) Sem qualificação `public.*` nos INSERTs.
--   3) Função sem owner garantido como `postgres` (role com
--      BYPASSRLS) → as policies `auth.uid() = user_id` dão
--      NULL durante o trigger e bloqueiam o INSERT.
--   4) Sem EXCEPTION block → qualquer erro derruba a transação
--      inteira do auth.users INSERT, abortando o signup.
--   5) Sem ON CONFLICT → reentrância (retry de signup) falha.
--
-- Esta migration substitui a função e o trigger pelo conjunto
-- corrigido. Não altera schemas das tabelas nem policies.
-- ============================================================


-- ============================================================
-- 1) Função corrigida
--    - SECURITY DEFINER + SET search_path = public, auth
--    - INSERTs schema-qualified (public.*)
--    - ON CONFLICT (user_id) DO NOTHING (idempotente)
--    - EXCEPTION WHEN OTHERS: loga via RAISE WARNING e
--      retorna NEW para NÃO derrubar o signup mesmo se algum
--      INSERT auxiliar falhar. Reconciliação fica a cargo
--      da aplicação (a tela /settings já sabe lidar com
--      bankroll vazia).
-- ============================================================
CREATE OR REPLACE FUNCTION public.init_user_data()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  INSERT INTO public.bankroll (user_id, current_balance, starting_balance)
  VALUES (NEW.id, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.framework_settings (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'init_user_data falhou para user %: % (%)',
      NEW.id, SQLERRM, SQLSTATE;
    RETURN NEW;
END;
$$;


-- ============================================================
-- 2) Owner = postgres (role do Supabase com BYPASSRLS)
--    Garante que o SECURITY DEFINER ignora as policies de
--    bankroll / framework_settings durante o signup, quando
--    auth.uid() ainda é NULL.
-- ============================================================
ALTER FUNCTION public.init_user_data() OWNER TO postgres;


-- ============================================================
-- 3) GRANTs explícitos
--    O trigger é disparado pelo role que insere em auth.users
--    (normalmente supabase_auth_admin). Concedemos EXECUTE
--    para todos os roles relevantes — defensivo, já que
--    SECURITY DEFINER troca o role efetivo, mas o role chamador
--    precisa poder INVOCAR a função.
-- ============================================================
GRANT EXECUTE ON FUNCTION public.init_user_data() TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.init_user_data() TO authenticated;
GRANT EXECUTE ON FUNCTION public.init_user_data() TO anon;
GRANT EXECUTE ON FUNCTION public.init_user_data() TO service_role;


-- ============================================================
-- 4) Recriar o trigger em auth.users
--    DROP IF EXISTS para idempotência. O trigger original na
--    001 referenciava `init_user_data()` sem schema; aqui
--    apontamos para `public.init_user_data()` explicitamente.
-- ============================================================
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.init_user_data();


-- ============================================================
-- 5) Backfill: usuários que já existem em auth.users mas não
--    têm bankroll / framework_settings (provavelmente zero ou
--    poucos casos, mas garante consistência depois da fix).
-- ============================================================
INSERT INTO public.bankroll (user_id, current_balance, starting_balance)
SELECT u.id, 0, 0
FROM auth.users u
LEFT JOIN public.bankroll b ON b.user_id = u.id
WHERE b.user_id IS NULL
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.framework_settings (user_id)
SELECT u.id
FROM auth.users u
LEFT JOIN public.framework_settings f ON f.user_id = u.id
WHERE f.user_id IS NULL
ON CONFLICT (user_id) DO NOTHING;
