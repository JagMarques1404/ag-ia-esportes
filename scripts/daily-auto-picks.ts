/**
 * Daily auto-picks — orquestrador da Fase E.0A.
 *
 *   npm run daily:auto-picks -- --date=YYYY-MM-DD --dryRun=true
 *   npm run daily:auto-picks -- --date=YYYY-MM-DD --dryRun=false
 *
 * Fluxo:
 *   1. Cria daily_pick_run (status='running').
 *   2. Sincroniza fixtures da data (custa 1 req).
 *   3. Filtra por AUTO_PICK_LEAGUE_NAMES.
 *   4. Para cada fixture:
 *      - se não tem lineup, sync lineups (1 req cada)
 *      - se tem lineup, roda runFixturePlayerIntel (sem API)
 *      - gera sugestões safe/value/mega/watchlist
 *   5. Em dryRun=true:
 *      - NÃO chama API
 *      - NÃO grava sugestões
 *      - Só relatório.
 *   6. Em dryRun=false:
 *      - Respeita quota floor (>= 30 reais restantes).
 *      - Grava daily_pick_suggestions.
 *      - NÃO cria public_picks automaticamente — fica como draft.
 *   7. Finaliza daily_pick_run (status='completed' ou 'failed').
 *
 * Regra de ouro: nunca falhar silenciosamente. Cada warning é logado
 * tanto no console quanto em daily_pick_runs.warnings (jsonb).
 */
process.env.AG_IA_SCRIPT_MODE = "true";

import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), ".env.local"), override: true });

interface CliArgs {
  date: string;
  dryRun: boolean;
}

const QUOTA_FLOOR = 30;

function parseArgs(): CliArgs {
  const argMap = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([a-zA-Z][a-zA-Z0-9-]*)(?:=(.+))?$/);
    if (m) argMap.set(m[1], m[2] ?? "true");
  }
  const rawDate = argMap.get("date");
  if (!rawDate || !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    throw new Error("--date=YYYY-MM-DD é obrigatório.");
  }
  const dryRunRaw = argMap.get("dryRun");
  const dryRun = dryRunRaw === undefined ? true : dryRunRaw !== "false";
  return { date: rawDate, dryRun };
}

function isPlanLimitError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('"plan"') ||
    m.includes("free plan") ||
    m.includes("do not have access to this date")
  );
}

async function main() {
  const args = parseArgs();
  console.log(
    `→ daily-auto-picks date=${args.date} dryRun=${args.dryRun}\n`
  );

  const { getSupabaseAdmin } = await import("../lib/supabase/admin");
  const { getActiveProvider } = await import("../lib/football-data/provider");
  const { AUTO_PICK_LEAGUE_NAMES } = await import(
    "../lib/football-data/priority-leagues"
  );
  const { getQuotaSummary } = await import("../lib/api-football/quota");
  const sb = getSupabaseAdmin();
  const provider = getActiveProvider();

  const warnings: string[] = [];
  let runId: string | null = null;

  function warn(msg: string) {
    warnings.push(msg);
    console.warn(`   ⚠ ${msg}`);
  }

  // ============================================================
  // 1. Criar run row (sempre — também em dryRun, para auditoria)
  // ============================================================
  if (!args.dryRun) {
    const { data: run, error: runErr } = await sb
      .from("daily_pick_runs")
      .insert({
        run_date: args.date,
        status: "running",
        provider: provider.getProviderName(),
      })
      .select("id")
      .single();
    if (runErr) {
      console.error(`✗ daily_pick_runs insert: ${runErr.message}`);
      process.exit(1);
    }
    runId = run.id as string;
    console.log(`→ run_id=${runId}`);
  } else {
    console.log("→ [dryRun] não cria daily_pick_run\n");
  }

  // ============================================================
  // 2. Sync fixtures da data (custa 1 req se for dryRun=false)
  // ============================================================
  const quotaBefore = await getQuotaSummary().catch(() => null);
  if (quotaBefore) {
    console.log(
      `→ quota antes: ${quotaBefore.realRequests}/${quotaBefore.limit} reais, ${quotaBefore.remaining} restantes`
    );
  }

  let fixturesFound = 0;
  if (!args.dryRun) {
    if (quotaBefore && quotaBefore.remaining <= QUOTA_FLOOR) {
      const msg = `Aborto: quota baixa (remaining=${quotaBefore.remaining} ≤ ${QUOTA_FLOOR}).`;
      await finalizeRun(sb, runId, "failed", { warnings: [...warnings, msg] });
      console.error(`\n✗ ${msg}`);
      process.exit(2);
    }
    try {
      const r = await provider.syncFixturesByDate(args.date);
      fixturesFound = r.total_fixtures ?? 0;
      console.log(`   ✓ syncFixturesByDate: ${fixturesFound} fixtures`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warn(`syncFixturesByDate falhou: ${msg.slice(0, 200)}`);
      if (isPlanLimitError(msg)) {
        await finalizeRun(sb, runId, "failed", { warnings });
        console.error("\n⛔ Plano grátis bloqueia. Parando.");
        process.exit(2);
      }
    }
  } else {
    console.log("→ [dryRun] não chama API — lê apenas o que já está em football_fixtures");
  }

  // ============================================================
  // 3. Listar fixtures da data filtrando por AUTO_PICK_LEAGUE_NAMES
  // ============================================================
  const { data: fixtureRows, error: fxErr } = await sb
    .from("football_fixtures")
    .select(
      "id, api_fixture_id, league_name, home_team_name, away_team_name, status, kickoff_at"
    )
    .eq("date", args.date)
    .in("league_name", AUTO_PICK_LEAGUE_NAMES as readonly string[] as string[])
    .order("kickoff_at", { ascending: true, nullsFirst: false });
  if (fxErr) {
    const msg = `select fixtures: ${fxErr.message}`;
    warn(msg);
    await finalizeRun(sb, runId, "failed", { warnings });
    process.exit(1);
  }

  const fixtures = fixtureRows ?? [];
  console.log(`\n=== Fixtures alvo (${fixtures.length} de ${fixturesFound || "?"}) ===`);
  for (const f of fixtures) {
    console.log(
      `   ${f.api_fixture_id}  ${f.league_name}  ${f.home_team_name} × ${f.away_team_name}  ${f.kickoff_at ?? ""}`
    );
  }
  if (fixtures.length === 0) {
    console.log("   (nenhum jogo de liga prioritária na data)");
    await finalizeRun(sb, runId, "completed", {
      fixtures_found: fixturesFound,
      warnings,
    });
    process.exit(0);
  }

  // ============================================================
  // 4. Para cada fixture: garantir lineup → rodar player-intel → gerar
  // ============================================================
  const { generateFixtureSuggestions } = await import(
    "../lib/player-intel/daily-suggestions"
  );
  const { runFixturePlayerIntel } = await import("../lib/player-intel");

  let lineupsSynced = 0;
  let boardsGenerated = 0;
  let suggestionsCreated = 0;

  interface Row {
    id: string;
    api_fixture_id: number;
    league_name: string | null;
    home_team_name: string | null;
    away_team_name: string | null;
  }

  for (const f of fixtures as Row[]) {
    console.log(
      `\n→ ${f.api_fixture_id}  ${f.league_name}  ${f.home_team_name} × ${f.away_team_name}`
    );

    // 4a. Tem lineup?
    const { count: lineupCount } = await sb
      .from("football_lineup_players")
      .select("*", { count: "exact", head: true })
      .eq("fixture_id", f.id);
    const hasLineup = (lineupCount ?? 0) > 0;
    console.log(`   lineup_players locais: ${lineupCount ?? 0}`);

    if (!hasLineup) {
      if (args.dryRun) {
        console.log(
          `   [dryRun] sem lineup local — pularia (custaria 1 req em real)`
        );
        continue;
      }
      const q = await getQuotaSummary().catch(() => null);
      if (q && q.remaining <= QUOTA_FLOOR) {
        warn(`Quota cruzou floor antes de ${f.api_fixture_id} — parando lineup sync`);
        break;
      }
      try {
        const r = await provider.syncFixtureLineups(f.api_fixture_id);
        lineupsSynced++;
        console.log(
          `   ✓ syncFixtureLineups: ${r.total_lineups} lineups, ${r.total_players} players`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isPlanLimitError(msg)) {
          warn(`Plan limit em ${f.api_fixture_id}. Parando lineup sync.`);
          break;
        }
        warn(
          `syncFixtureLineups(${f.api_fixture_id}) falhou: ${msg.slice(0, 120)}`
        );
        continue;
      }
    }

    // 4b. Rodar runFixturePlayerIntel (sem API) — popula
    //     football_player_action_probabilities. Em dryRun também roda
    //     porque não custa quota.
    try {
      const r = await runFixturePlayerIntel(f.api_fixture_id);
      boardsGenerated++;
      console.log(
        `   ✓ player-intel: ${r.players_analyzed} players, ${r.probabilities_generated} probs, dq médio ${r.data_quality_avg}`
      );
      if (r.warnings.length > 0) {
        for (const w of r.warnings.slice(0, 3)) warn(`  [${f.api_fixture_id}] ${w}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warn(`runFixturePlayerIntel(${f.api_fixture_id}) falhou: ${msg.slice(0, 200)}`);
      continue;
    }

    // 4c. Gerar sugestões
    let s;
    try {
      s = await generateFixtureSuggestions(f.api_fixture_id);
    } catch (err) {
      warn(
        `generateFixtureSuggestions(${f.api_fixture_id}) falhou: ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }
    const blocks: ReadonlyArray<keyof typeof s> = ["safe", "value", "mega", "watchlist"];
    let printed = 0;
    for (const k of blocks) {
      const b = s[k];
      if (b == null || typeof b !== "object" || !("legs" in b)) continue;
      const block = b as { risk_level: string; legs: { player_name: string; action_key: string; probability: number; sample_size: number; data_origin: string }[]; estimated_probability: number; data_quality_score: number; worst_leg: string | null };
      printed++;
      console.log(
        `   - ${block.risk_level.padEnd(9)} legs=${block.legs.length} prob=${block.estimated_probability.toFixed(3)} dq=${block.data_quality_score.toFixed(2)}`
      );
      for (const leg of block.legs.slice(0, 3)) {
        console.log(
          `       · ${leg.player_name.padEnd(22)} ${leg.action_key.padEnd(15)} p=${leg.probability.toFixed(2)} n=${leg.sample_size} ${leg.data_origin}`
        );
      }
    }
    if (printed === 0) {
      console.log(
        `   (sem sugestões — elegíveis=${s.eligible_count}, total=${s.total_count})`
      );
    }

    // 4d. Em dryRun=false: gravar
    if (!args.dryRun && runId) {
      for (const k of blocks) {
        const b = s[k];
        if (b == null || typeof b !== "object" || !("legs" in b)) continue;
        const block = b as Awaited<ReturnType<typeof generateFixtureSuggestions>>["safe"];
        if (!block) continue;
        // Política conservadora: tudo entra como 'draft' nesta fase.
        // Publicação automática só virá quando tivermos hand-off claro
        // para public_picks (próxima fase).
        const { error: insErr } = await sb
          .from("daily_pick_suggestions")
          .insert({
            run_id: runId,
            run_date: args.date,
            api_fixture_id: f.api_fixture_id,
            league_name: f.league_name,
            match_name: s.match_name,
            risk_level: block.risk_level,
            status: "draft",
            title: `${block.risk_level.toUpperCase()} · ${s.match_name}`,
            rationale: block.rationale,
            worst_leg: block.worst_leg,
            estimated_probability: block.estimated_probability,
            confidence_score: block.confidence_score,
            data_quality_score: block.data_quality_score,
            suggestions: block.legs as unknown as object,
          });
        if (insErr) {
          warn(
            `insert suggestion (${f.api_fixture_id}/${block.risk_level}): ${insErr.message}`
          );
          continue;
        }
        suggestionsCreated++;
      }
    }
  }

  // ============================================================
  // 5. Resumo final
  // ============================================================
  const quotaAfter = await getQuotaSummary().catch(() => null);

  console.log("\n=== Resumo ===");
  console.log(`  fixtures encontrados (data total): ${fixturesFound}`);
  console.log(`  fixtures alvo (auto-pick leagues): ${fixtures.length}`);
  console.log(`  lineups sincronizadas:             ${lineupsSynced}`);
  console.log(`  boards gerados:                    ${boardsGenerated}`);
  console.log(`  sugestões gravadas:                ${suggestionsCreated}`);
  console.log(`  warnings:                          ${warnings.length}`);
  if (quotaBefore && quotaAfter) {
    console.log(
      `  quota: ${quotaBefore.realRequests}/${quotaBefore.limit} → ${quotaAfter.realRequests}/${quotaAfter.limit}`
    );
    console.log(
      `  reais consumidas: ${quotaAfter.realRequests - quotaBefore.realRequests}`
    );
  }

  await finalizeRun(sb, runId, "completed", {
    fixtures_found: fixturesFound,
    lineups_synced: lineupsSynced,
    boards_generated: boardsGenerated,
    suggestions_created: suggestionsCreated,
    warnings,
  });

  if (args.dryRun) {
    console.log("\n[dryRun] sem chamadas à API. Para coletar real:");
    console.log(
      `   npm run daily:auto-picks -- --date=${args.date} --dryRun=false`
    );
  }
  process.exit(0);
}

interface FinalizeArgs {
  fixtures_found?: number;
  lineups_synced?: number;
  boards_generated?: number;
  suggestions_created?: number;
  picks_created?: number;
  warnings?: string[];
}

async function finalizeRun(
  sb: ReturnType<typeof import("../lib/supabase/admin").getSupabaseAdmin>,
  runId: string | null,
  status: "completed" | "failed",
  payload: FinalizeArgs
): Promise<void> {
  if (!runId) return;
  await sb
    .from("daily_pick_runs")
    .update({
      status,
      fixtures_found: payload.fixtures_found ?? 0,
      lineups_synced: payload.lineups_synced ?? 0,
      boards_generated: payload.boards_generated ?? 0,
      suggestions_created: payload.suggestions_created ?? 0,
      picks_created: payload.picks_created ?? 0,
      warnings: (payload.warnings ?? []) as unknown as object,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);
}

main().catch((err) => {
  console.error("\n✗ Erro fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
