/**
 * Import manual de histórico last5 por jogador (Fase E.0A.6).
 *
 *   npm run import:manual-player-history -- --file=data/manual-history/X.json --dryRun=true
 *   npm run import:manual-player-history -- --file=data/manual-history/X.json --dryRun=false
 *
 * Quando o plano free do API-Football bloqueia /fixtures?team=&last=,
 * o usuário cola manualmente o histórico em JSON. Este script:
 *
 *   1. Lê o arquivo.
 *   2. Resolve cada player_name contra football_lineup_players do
 *      fixture alvo (precisa de E.0A.5 ter rodado antes — players
 *      reais, não sintéticos).
 *   3. Para cada match histórico, cria/reutiliza um fixture sintético
 *      (api_fixture_id >= 900M) com status='FT' para o pipeline aceitar.
 *   4. UPSERT football_player_match_stats com source='manual_history'.
 *   5. Mostra novo readiness do fixture alvo.
 *
 * Idempotente: deleta stats com source='manual_history' do mesmo
 * (player, fixture) antes de reinserir.
 *
 * NÃO chama API. NÃO toca em bets/banca.
 */
process.env.AG_IA_SCRIPT_MODE = "true";

import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

loadEnv({ path: resolve(process.cwd(), ".env.local"), override: true });

// ============================================================
// CLI
// ============================================================

interface CliArgs {
  file: string;
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const argMap = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([a-zA-Z][a-zA-Z0-9-]*)(?:=(.+))?$/);
    if (m) argMap.set(m[1], m[2] ?? "true");
  }
  const file = argMap.get("file");
  if (!file) throw new Error("--file=<caminho do JSON> é obrigatório.");
  const dryRunRaw = argMap.get("dryRun");
  const dryRun = dryRunRaw === undefined ? true : dryRunRaw !== "false";
  return { file, dryRun };
}

// ============================================================
// Schema do JSON
// ============================================================

interface ManualHistoryMatch {
  date: string;            // YYYY-MM-DD
  opponent: string;
  minutes?: number;
  shots?: number;
  shots_on?: number;
  fouls_committed?: number;
  fouls_drawn?: number;
  tackles?: number;
  interceptions?: number;
  key_passes?: number;
  yellow_cards?: number;
  red_cards?: number;
  goals?: number;
  assists?: number;
  offsides?: number;
  blocks?: number;
  duels_total?: number;
  duels_won?: number;
}

interface ManualHistoryPlayer {
  player_name: string;
  team_name: string;
  matches: ManualHistoryMatch[];
}

interface ManualHistoryFile {
  fixture: number;             // api_fixture_id alvo
  source?: string;
  notes?: string;
  players: ManualHistoryPlayer[];
}

// ============================================================
// Helpers
// ============================================================

function normName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

const SYNTHETIC_API_PLAYER_ID_MIN = 800_000_000;
const SYNTHETIC_FIXTURE_BASE = 900_000_000;

/** Hash determinístico DJB2 → range [0, 99_999_999]. */
function hash99M(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 100_000_000;
}

function syntheticFixtureId(date: string, teamKey: string, opponent: string): number {
  return SYNTHETIC_FIXTURE_BASE + hash99M(`${date}|${teamKey}|${normName(opponent)}`);
}

// ============================================================
// Main
// ============================================================

async function main() {
  const args = parseArgs();
  console.log(`→ import-manual-player-history file=${args.file} dryRun=${args.dryRun}\n`);

  const raw = readFileSync(args.file, "utf-8");
  const data = JSON.parse(raw) as ManualHistoryFile;
  if (!data.fixture || !Array.isArray(data.players)) {
    throw new Error("JSON inválido: precisa de { fixture: number, players: [] }");
  }

  const { getSupabaseAdmin } = await import("../lib/supabase/admin");
  const { evaluateFixtureReadinessForPick } = await import(
    "../lib/player-intel/readiness-gate"
  );
  const sb = getSupabaseAdmin();

  // ============================================================
  // 1. Fixture alvo + lineup
  // ============================================================
  const { data: target } = await sb
    .from("football_fixtures")
    .select("id, api_fixture_id, home_team_name, away_team_name")
    .eq("api_fixture_id", data.fixture)
    .maybeSingle();
  if (!target) {
    throw new Error(
      `Fixture alvo ${data.fixture} não encontrada. Rode seed:manual-lineups antes.`
    );
  }
  const targetFixtureId = target.id as string;
  console.log(
    `→ Fixture alvo: ${target.home_team_name} × ${target.away_team_name} (id=${targetFixtureId.slice(0, 8)}…)`
  );

  const { data: lineupRows } = await sb
    .from("football_lineup_players")
    .select("api_player_id, player_id, player_name, team_id")
    .eq("fixture_id", targetFixtureId);
  const lineup = (lineupRows ?? []) as Array<{
    api_player_id: number | null;
    player_id: string | null;
    player_name: string | null;
    team_id: string | null;
  }>;
  console.log(`→ Lineup local: ${lineup.length} players`);

  // Index por nome normalizado → resolve real api_player_id
  const lineupByName = new Map<
    string,
    Array<{ api_player_id: number; player_id: string | null; team_id: string | null; player_name: string }>
  >();
  for (const lp of lineup) {
    if (lp.api_player_id == null || lp.api_player_id <= 0) continue;
    const key = normName(lp.player_name ?? "");
    if (!key) continue;
    const arr = lineupByName.get(key) ?? [];
    arr.push({
      api_player_id: lp.api_player_id,
      player_id: lp.player_id,
      team_id: lp.team_id,
      player_name: lp.player_name ?? "",
    });
    lineupByName.set(key, arr);
  }

  // ============================================================
  // 2. Processar cada player
  // ============================================================
  let totalMatchesInserted = 0;
  let totalFixturesUpserted = 0;
  const skipped: Array<{ player_name: string; reason: string }> = [];
  const imported: Array<{ player_name: string; matches: number }> = [];

  for (const p of data.players) {
    const key = normName(p.player_name);
    const matches = lineupByName.get(key) ?? [];

    if (matches.length === 0) {
      skipped.push({
        player_name: p.player_name,
        reason: "não encontrado no lineup do fixture alvo",
      });
      continue;
    }
    if (matches.length > 1) {
      // Ambíguo
      skipped.push({
        player_name: p.player_name,
        reason: `ambíguo no lineup (${matches.length} matches: ${matches.map((m) => m.player_name).join(", ")})`,
      });
      continue;
    }
    const resolved = matches[0];
    if (resolved.api_player_id >= SYNTHETIC_API_PLAYER_ID_MIN) {
      skipped.push({
        player_name: p.player_name,
        reason: `lineup tem id sintético (${resolved.api_player_id}) — resolva o player primeiro via seed:manual-lineups --resolveApi=true`,
      });
      continue;
    }

    console.log(
      `\n→ ${p.player_name}  (api=${resolved.api_player_id}, ${p.matches.length} match(es) no JSON)`
    );

    if (args.dryRun) {
      console.log(`   [dryRun] processaria ${p.matches.length} matches`);
      imported.push({ player_name: p.player_name, matches: p.matches.length });
      continue;
    }

    // ============================================================
    // 3. Para cada match, garantir fixture sintético + INSERT stat
    // ============================================================
    let insertedForPlayer = 0;
    for (const m of p.matches) {
      const teamKey = String(resolved.team_id ?? p.team_name);
      const apiFx = syntheticFixtureId(m.date, teamKey, m.opponent);

      // 3a. Upsert fixture sintético (status=FT, league_name='manual_history')
      const fixturePayload = {
        api_fixture_id: apiFx,
        date: m.date,
        kickoff_at: `${m.date}T12:00:00+00:00`,
        league_name: "manual_history",
        season: Number.parseInt(m.date.slice(0, 4), 10),
        status: "FT",
        home_team_id: resolved.team_id,
        home_team_name: p.team_name,
        away_team_name: m.opponent,
      };
      const { error: fxErr } = await sb
        .from("football_fixtures")
        .upsert(fixturePayload, { onConflict: "api_fixture_id" });
      if (fxErr) {
        console.warn(`   ⚠ upsert fixture ${apiFx}: ${fxErr.message}`);
        continue;
      }
      // Resolver fixture_id local
      const { data: localFx } = await sb
        .from("football_fixtures")
        .select("id")
        .eq("api_fixture_id", apiFx)
        .maybeSingle();
      if (!localFx) {
        console.warn(`   ⚠ não encontrou fixture local após upsert (${apiFx})`);
        continue;
      }
      const localFxId = localFx.id as string;
      totalFixturesUpserted++;

      // 3b. Idempotência: deleta stats anteriores manuais desse player+fixture
      await sb
        .from("football_player_match_stats")
        .delete()
        .eq("fixture_id", localFxId)
        .eq("api_player_id", resolved.api_player_id)
        .eq("source", "manual_history");

      // 3c. INSERT stat
      const { error: psErr } = await sb
        .from("football_player_match_stats")
        .insert({
          fixture_id: localFxId,
          team_id: resolved.team_id,
          opponent_team_id: null,
          player_id: resolved.player_id,
          api_player_id: resolved.api_player_id,
          player_name: p.player_name,
          minutes: m.minutes ?? 0,
          shots_total: m.shots ?? 0,
          shots_on: m.shots_on ?? 0,
          goals: m.goals ?? 0,
          assists: m.assists ?? 0,
          passes_key: m.key_passes ?? 0,
          tackles_total: m.tackles ?? 0,
          interceptions: m.interceptions ?? 0,
          duels_total: m.duels_total ?? 0,
          duels_won: m.duels_won ?? 0,
          fouls_drawn: m.fouls_drawn ?? 0,
          fouls_committed: m.fouls_committed ?? 0,
          yellow_cards: m.yellow_cards ?? 0,
          red_cards: m.red_cards ?? 0,
          offsides: m.offsides ?? 0,
          blocks: m.blocks ?? 0,
          source: "manual_history",
          raw_source: data.notes ?? "manual import",
          confidence_score: 0.8,
        });
      if (psErr) {
        console.warn(`   ⚠ insert player_stat: ${psErr.message}`);
        continue;
      }
      insertedForPlayer++;
      totalMatchesInserted++;
    }
    console.log(`   ✓ ${insertedForPlayer}/${p.matches.length} stats inseridas`);
    imported.push({ player_name: p.player_name, matches: insertedForPlayer });
  }

  // ============================================================
  // 4. Relatório
  // ============================================================
  console.log("\n=== Resumo ===");
  console.log(`  jogadores importados:        ${imported.length}`);
  console.log(`  jogadores pulados:           ${skipped.length}`);
  console.log(`  match-stats inseridos:       ${totalMatchesInserted}`);
  console.log(`  fixtures sintéticos upsert:  ${totalFixturesUpserted}`);

  if (imported.length > 0) {
    console.log("\n  Importados:");
    for (const i of imported) {
      console.log(`    - ${i.player_name.padEnd(28)} ${i.matches} match(es)`);
    }
  }
  if (skipped.length > 0) {
    console.log("\n  Pulados:");
    for (const s of skipped) {
      console.log(`    - ${s.player_name.padEnd(28)} → ${s.reason}`);
    }
  }

  // ============================================================
  // 5. Novo readiness do fixture alvo
  // ============================================================
  if (!args.dryRun) {
    try {
      const report = await evaluateFixtureReadinessForPick(data.fixture);
      console.log(`\n=== Novo readiness do fixture ${data.fixture} ===`);
      console.log(`  jogo:               ${report.match_name}`);
      console.log(`  com histórico:      ${report.with_history}/${report.total_lineup_players}`);
      console.log(`  ofensivos c/ hist:  ${report.offensive_with_history}`);
      console.log(`  dq médio:           ${report.avg_data_quality.toFixed(3)}`);
      console.log(`  decisão:            ${report.level}`);
      console.log(`  motivo:             ${report.reason}`);
    } catch (err) {
      console.warn(
        `\n⚠ readiness falhou: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  } else {
    console.log("\n[dryRun] sem writes. Para aplicar:");
    console.log(
      `   npm run import:manual-player-history -- --file=${args.file} --dryRun=false`
    );
    console.log("\n→ Depois rode:");
    console.log(
      `   npm run report:manual-lineup-readiness -- --fixture=${data.fixture}`
    );
    console.log(
      `   npm run test:player-action-board -- --fixture=${data.fixture}`
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("\n✗ Erro fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
