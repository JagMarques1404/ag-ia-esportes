# 🚀 Guia Completo de Deploy - AG IA ESPORTES

## Passo 1: Criar Repositório no GitHub

### 1.1 Acessar GitHub
1. Vá para https://github.com
2. Faça login com sua conta: `joao.melanciatv@gmail.com`

### 1.2 Criar Novo Repositório
1. Clique no botão **"New"** (verde, canto superior direito)
2. Preencha os campos:
   - **Repository name**: `ag-ia-esportes`
   - **Description**: `Sistema de análise esportiva com IA para identificação de oportunidades de valor no mercado de apostas`
   - **Visibilidade**: ✅ Public (marcado)
   - **Initialize**: ❌ NÃO marque nenhuma opção (README, .gitignore, license)
3. Clique em **"Create repository"**

### 1.3 Conectar Repositório Local
Após criar o repositório, o GitHub mostrará comandos. Use estes:

```bash
git remote add origin https://github.com/joao.melanciatv/ag-ia-esportes.git
git branch -M main
git push -u origin main
```

**IMPORTANTE**: Cole esses comandos EXATAMENTE como aparecem na sua tela do GitHub.

---

## Passo 2: Deploy na Vercel

### 2.1 Acessar Vercel
1. Vá para https://vercel.com
2. Clique em **"Sign Up"** ou **"Login"**
3. Escolha **"Continue with GitHub"**
4. Autorize a Vercel a acessar sua conta GitHub

### 2.2 Importar Projeto
1. No dashboard da Vercel, clique em **"New Project"**
2. Encontre o repositório `ag-ia-esportes` na lista
3. Clique em **"Import"** ao lado do repositório

### 2.3 Configurar Deploy
1. **Project Name**: `ag-ia-esportes` (deixe como está)
2. **Framework Preset**: Vite (deve detectar automaticamente)
3. **Root Directory**: `./` (deixe como está)
4. **Build Command**: `pnpm run build` (deixe como está)
5. **Output Directory**: `dist` (deixe como está)

### 2.4 Configurar Variáveis de Ambiente
Na seção **"Environment Variables"**, adicione EXATAMENTE estas variáveis:

**IMPORTANTE**: Cole os valores EXATOS que você me forneceu:

```
VITE_SUPABASE_URL
https://sfihzieydbtjuibxhmzd.supabase.co

VITE_SUPABASE_ANON_KEY
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNmaWh6aWV5ZGJ0anVpYnhobXpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkwNzA0MDAsImV4cCI6MjA3NDY0NjQwMH0.8Vh8Q18jJnZcqbWZxJMdycj6wAp2DegLq-NK4eFJPvQ

VITE_APIFOOTBALL_KEY
157fc5344ece5dd73622beca7ac7d763

VITE_THEODDSAPI_KEY
3fb30e3e38e2f45613d65af7cd474c11

VITE_OPENWEATHER_KEY
a87286e8dfaae92e4bac3c8e48a71b19

VITE_API_INTERNAL_TOKEN
9b8c7a2f6e3d4f0a1b5c9d8e2f3a6b7c

APP_ENV
production
```

**Como adicionar cada variável:**
1. No campo **"Name"**, cole o nome da variável (ex: `VITE_SUPABASE_URL`)
2. No campo **"Value"**, cole o valor correspondente
3. Clique em **"Add"**
4. Repita para todas as 7 variáveis

### 2.5 Finalizar Deploy
1. Após adicionar todas as variáveis, clique em **"Deploy"**
2. Aguarde o build terminar (2-3 minutos)
3. Quando aparecer "🎉 Your project has been deployed", clique em **"Visit"**

---

## Passo 3: Configurar Domínio Personalizado

### 3.1 Adicionar Domínio na Vercel
1. No dashboard do projeto, vá para **"Settings"** → **"Domains"**
2. Clique em **"Add"**
3. Digite: `agenteesportivo.com.br`
4. Clique em **"Add"**
5. Repita para: `www.agenteesportivo.com.br`

### 3.2 Configurar DNS (Registro.br)
A Vercel mostrará os registros DNS necessários. Configure no Registro.br:

**Tipo A** (para agenteesportivo.com.br):
- **Nome**: `@` ou deixe vazio
- **Valor**: `76.76.21.21`

**Tipo CNAME** (para www.agenteesportivo.com.br):
- **Nome**: `www`
- **Valor**: `cname.vercel-dns.com`

### 3.3 Aguardar Propagação
- DNS pode levar até 24 horas para propagar
- Você pode verificar em https://dnschecker.org

---

## Passo 4: Configurar Banco de Dados

### 4.1 Executar Schema no Supabase
1. Vá para https://supabase.com/dashboard
2. Abra seu projeto `ag-ia-esportes`
3. Vá para **"SQL Editor"**
4. Clique em **"New query"**
5. Cole o conteúdo do arquivo `database_schema.sql`
6. Clique em **"Run"**

### 4.2 Definir Senha do Banco
1. Vá para **"Settings"** → **"Database"**
2. Na seção **"Connection string"**, clique em **"Reset database password"**
3. Digite uma senha forte (ex: `@Jag831540JOAO`)
4. Confirme a senha
5. Copie a nova **Connection string** completa

### 4.3 Atualizar Variável de Ambiente
1. Volte para a Vercel
2. Vá para **"Settings"** → **"Environment Variables"**
3. Adicione uma nova variável:
   - **Name**: `DATABASE_URL`
   - **Value**: Cole a connection string completa do Supabase

---

## Passo 5: Testar Sistema

### 5.1 Testar Cron Job
1. Acesse: `https://seu-dominio.vercel.app/api/daily-process`
2. Use método POST com header:
   ```
   Authorization: Bearer 9b8c7a2f6e3d4f0a1b5c9d8e2f3a6b7c
   ```
3. Body JSON:
   ```json
   { "type": "test" }
   ```

### 5.2 Verificar Funcionamento
1. Acesse seu site: `https://agenteesportivo.com.br`
2. Verifique se os picks estão carregando
3. Teste a responsividade em mobile

---

## 📋 Checklist Final

- [ ] Repositório criado no GitHub
- [ ] Código enviado para o repositório
- [ ] Projeto importado na Vercel
- [ ] Todas as 7 variáveis de ambiente configuradas
- [ ] Deploy realizado com sucesso
- [ ] Domínios adicionados na Vercel
- [ ] DNS configurado no Registro.br
- [ ] Schema do banco executado no Supabase
- [ ] Senha do banco definida
- [ ] DATABASE_URL adicionada na Vercel
- [ ] Site funcionando em produção
- [ ] Cron job testado

---

## 🆘 Resolução de Problemas

### Build Falha
- Verifique se todas as variáveis de ambiente estão corretas
- Confirme que não há erros de sintaxe no código

### Site Não Carrega
- Verifique se o DNS propagou
- Confirme se o domínio está ativo na Vercel

### Dados Não Aparecem
- Verifique se o schema do banco foi executado
- Confirme se as credenciais do Supabase estão corretas
- Teste o endpoint `/api/daily-process` manualmente

### Cron Job Não Funciona
- Verifique se o `API_INTERNAL_TOKEN` está correto
- Confirme se o endpoint responde manualmente
- Verifique logs na Vercel

---

## 📞 Próximos Passos

Após o deploy:
1. **Monitorar**: Acompanhe os logs na Vercel
2. **Testar**: Execute o processamento diário manualmente
3. **Otimizar**: Ajuste parâmetros do modelo conforme necessário
4. **Expandir**: Adicione novos mercados e funcionalidades

**🎉 Parabéns! Seu AG IA ESPORTES estará no ar!**
