/**
 * Smoke test local da Fase 2.
 *
 * Carrega .env.local manualmente (Node ainda não dá isso de graça
 * para tsx) e roda syncTodayFixtures contra o Supabase + API-Football
 * configurados nas envs.
 *
 * Rodar:
 *   npm run test:fixtures:today
 *
 * AG_IA_SCRIPT_MODE=true diz ao server-only-guard para PULAR o
 * `import "server-only"` (que sempre lança fora do bundler do Next).
 * Em produção essa env nunca é setada — server-only continua ativo.
 */
process.env.AG_IA_SCRIPT_MODE = "true";

import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

// dotenv/config carrega .env por default; carregar .env.local em cima.
loadEnv({ path: resolve(process.cwd(), ".env.local"), override: true });

async function main() {
  // Imports tardios para que as envs sejam aplicadas antes dos módulos
  // chamarem getApiFootballConfig/getSupabaseAdmin.
  const { syncTodayFixtures } = await import("../lib/api-football/sync");
  const { getQuotaSummary } = await import("../lib/api-football/quota");

  console.log("→ Iniciando sync de fixtures de hoje...\n");

  try {
    const result = await syncTodayFixtures();
    console.log("✓ Sync concluído:");
    console.log(`   data:        ${result.date}`);
    console.log(`   fixtures:    ${result.total_fixtures}`);
    console.log(`   ligas:       ${result.total_leagues}`);
    console.log(`   times:       ${result.total_teams}`);
    console.log(`   sync_run_id: ${result.syncRunId}`);

    const quota = await getQuotaSummary();
    console.log("\n→ Quota hoje:");
    console.log(`   reqs reais:     ${quota.realRequests} / ${quota.limit}`);
    console.log(`   reqs cacheadas: ${quota.cachedRequests}`);
    console.log(`   restantes:      ${quota.remaining}`);
    console.log(`   soft-limit:     ${quota.softLimit}`);
    console.log(`   erros hoje:     ${quota.errors}`);

    process.exit(0);
  } catch (err) {
    console.error("\n✗ Erro:");
    console.error(err instanceof Error ? err.message : err);
    if (err instanceof Error && err.stack) {
      console.error("\nStack:");
      console.error(err.stack);
    }
    process.exit(1);
  }
}

void main();
