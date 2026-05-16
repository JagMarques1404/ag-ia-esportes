/**
 * Relatório de readiness de escalações manuais (Fase E.0A.5).
 *
 *   npm run report:manual-lineup-readiness
 *   npm run report:manual-lineup-readiness -- --fixture=1388606
 *
 * Sem args: roda para TODOS os fixtures que têm lineup source='manual_predicted'.
 * Com --fixture=ID: roda só pra esse api_fixture_id.
 *
 * Mostra:
 *   - fixture · jogo
 *   - total lineup players
 *   - resolvidos com histórico
 *   - resolvidos sem histórico
 *   - sintéticos
 *   - ambíguos
 *   - data_quality médio
 *   - readiness_score
 *   - decisão: READY | WATCHLIST | BLOCKED
 *   - "Jogadores para buscar manualmente/API"
 */
process.env.AG_IA_SCRIPT_MODE = "true";

import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), ".env.local"), override: true });

interface CliArgs {
  apiFixtureId?: number;
}

function parseArgs(): CliArgs {
  const argMap = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([a-zA-Z][a-zA-Z0-9-]*)(?:=(.+))?$/);
    if (m) argMap.set(m[1], m[2] ?? "true");
  }
  const raw = argMap.get("fixture");
  if (raw) {
    const id = Number.parseInt(raw, 10);
    if (Number.isFinite(id) && id > 0) return { apiFixtureId: id };
    throw new Error(`--fixture inválido: ${raw}`);
  }
  return {};
}

async function main() {
  const args = parseArgs();
  console.log(
    `→ report-manual-lineup-readiness${args.apiFixtureId ? ` fixture=${args.apiFixtureId}` : " (todos)"}\n`
  );

  const { getSupabaseAdmin } = await import("../lib/supabase/admin");
  const { evaluateFixtureReadinessForPick } = await import(
    "../lib/player-intel/readiness-gate"
  );
  const sb = getSupabaseAdmin();

  // 1. Listar fixtures com lineup manual
  let fixtureIds: number[];
  if (args.apiFixtureId) {
    fixtureIds = [args.apiFixtureId];
  } else {
    const { data } = await sb
      .from("football_lineups")
      .select("fixture_id, football_fixtures!inner(api_fixture_id)")
      .eq("source", "manual_predicted");
    const set = new Set<number>();
    for (const row of (data ?? []) as Array<{
      football_fixtures:
        | { api_fixture_id?: number | null }
        | Array<{ api_fixture_id?: number | null }>
        | null;
    }>) {
      const rel = row.football_fixtures;
      const id = Array.isArray(rel) ? rel[0]?.api_fixture_id : rel?.api_fixture_id;
      if (id != null && id > 0) set.add(id);
    }
    fixtureIds = Array.from(set).sort((a, b) => a - b);
  }

  if (fixtureIds.length === 0) {
    console.log("  (nenhum fixture com lineup manual encontrado)");
    process.exit(0);
  }

  console.log(`Encontrados ${fixtureIds.length} fixture(s) com escalação manual.\n`);

  // 2. Para cada fixture, avalia
  const aggregate = { READY: 0, WATCHLIST: 0, BLOCKED: 0 };

  for (const apiFixtureId of fixtureIds) {
    let report;
    try {
      report = await evaluateFixtureReadinessForPick(apiFixtureId);
    } catch (err) {
      console.log(
        `\n→ ${apiFixtureId}  (erro: ${err instanceof Error ? err.message : String(err)})`
      );
      continue;
    }
    aggregate[report.level]++;

    const decisionEmoji =
      report.level === "READY" ? "✓" : report.level === "WATCHLIST" ? "◐" : "✗";
    const decisionLabel =
      report.level === "READY"
        ? "PRONTO PARA PICK"
        : report.level === "WATCHLIST"
          ? "WATCHLIST"
          : "BLOQUEADO";

    console.log(`\n→ ${apiFixtureId}  ${report.match_name}`);
    console.log(`   total lineup players:       ${report.total_lineup_players}`);
    console.log(`   resolvidos COM histórico:   ${report.with_history}`);
    console.log(`     (ofensivos):              ${report.offensive_with_history}`);
    console.log(`   resolvidos SEM histórico:   ${report.matched_no_history}`);
    console.log(`   sintéticos / unmatched:     ${report.synthetic}`);
    console.log(`   data_quality médio:         ${report.avg_data_quality.toFixed(3)}`);
    const readinessScore =
      report.total_lineup_players > 0
        ? Math.round(
            (report.with_history / report.total_lineup_players) * 100
          )
        : 0;
    console.log(`   readiness_score:            ${readinessScore}%`);
    console.log(`   decisão:                    ${decisionEmoji} ${decisionLabel}`);
    console.log(`   motivo:                     ${report.reason}`);

    if (report.missing_players.length > 0) {
      console.log(`\n   Jogadores para buscar manualmente/API:`);
      for (const m of report.missing_players.slice(0, 15)) {
        const teamSuffix = m.team_name ? ` (${m.team_name})` : "";
        console.log(`     - ${m.player_name.padEnd(28)}${teamSuffix.padEnd(18)} → ${m.why}`);
      }
      if (report.missing_players.length > 15) {
        console.log(`     ... e mais ${report.missing_players.length - 15}`);
      }
    }
  }

  console.log("\n=== Agregado ===");
  console.log(`  READY:     ${aggregate.READY}`);
  console.log(`  WATCHLIST: ${aggregate.WATCHLIST}`);
  console.log(`  BLOCKED:   ${aggregate.BLOCKED}`);

  console.log("\n→ Próximos passos sugeridos:");
  if (aggregate.BLOCKED > 0 || aggregate.WATCHLIST > 0) {
    console.log(
      `   1. Rode \`collect:player-last5\` para os jogadores 'matched sem histórico'.`
    );
    console.log(
      `   2. Para sintéticos (manuais não resolvidos), busque o jogador real na fonte e adicione ao banco antes do seed.`
    );
  } else {
    console.log(`   Todos os fixtures estão READY. Pode prosseguir para publicação.`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("\n✗ Erro fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
