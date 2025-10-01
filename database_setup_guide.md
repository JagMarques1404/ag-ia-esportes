# Guia para Executar o Schema do Banco de Dados

## Passo 1: Acessar o SQL Editor do Supabase
1. Vá para o seu projeto: https://sfihzieydbtjuibxhmzd.supabase.co
2. No menu lateral esquerdo, clique em **"SQL Editor"**
3. Clique em **"New query"** (botão verde no canto superior direito)

## Passo 2: Executar o Schema
1. **COPIE TODO O CONTEÚDO** do arquivo `database_schema.sql` (que está no projeto)
2. **COLE NO EDITOR SQL** (substitua qualquer conteúdo que estiver lá)
3. Clique em **"Run"** (botão azul no canto inferior direito)

## Passo 3: Verificar se Funcionou
Após executar, você deve ver:
- Uma mensagem de sucesso (verde)
- As tabelas criadas aparecerão no menu **"Table Editor"**

## ⚠️ IMPORTANTE:
- Execute TODO o conteúdo do arquivo de uma vez só
- Se der erro, me avise qual foi a mensagem
- NÃO modifique o SQL, apenas copie e cole

## Tabelas que serão criadas:
- `fixtures` (jogos)
- `odds_snapshots` (odds capturadas)
- `recommendations` (resultado do modelo)
- `daily_publications` (Top Picks do dia)
- `model_runs` (monitoramento)

Após executar com sucesso, me confirme que deu certo!
