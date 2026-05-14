/**
 * Player Intel Readiness Scanner.
 *
 *   npm run readiness:player-intel
 *   npm run readiness:player-intel -- --limit=20 --daysForward=2 --daysBack=1
 *   npm run readiness:player-intel -- --date=2026-05-15
 *
 * Para cada fixture na janela (somente ligas prioritárias), conta
 * quantos jogadores dos dois times já têm histórico no banco e calcula
 * um readiness_score. Não chama API, não consome quota.
 *
 * Usa apenas football_fixtures + football_player_match_stats. Como
 * lineups dos jogos futuros não estão no banco, a aproximação é:
 * "todos os jogadores que já apareceram em algum jogo do mesmo time".
 */
process.env.AG_IA_SCRIPT_MODE = "true";

import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), ".env.local"), override: true });

interface CliArgs {
  date: string | undefined;
  daysForward: number;
  daysBack: number;
  limit: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FIXTURE_STATUSES = ["NS", "TBD", "1H", "2H", "HT", "FT", "AET", "PEN"];

function parseArgs(): CliArgs {
  const argMap = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([a-zA-Z][a-zA-Z0-9-]*)(?:=(.+))?$/);
    if (m) argMap.set(m[1], m[2] ?? "true");
  }
  const date = argMap.get("date");
  if (date && !DATE_RE.test(date)) {
    throw new Error(`--date inválido: ${date}. Use YYYY-MM-DD.`);
  }
  const daysForward = Number.parseInt(argMap.get("daysForward") ?? "2", 10);
  const daysBack = Number.parseInt(argMap.get("daysBack") ?? "1", 10);
  const limit = Number.parseInt(argMap.get("limit") ?? "20", 10);
  if (
    !Number.isFinite(daysForward) ||
    daysForward < 0 ||
    daysForward > 30
  ) {
    throw new Error(`--daysForward inválido: ${argMap.get("daysForward")}`);
  }
  if (!Number.isFinite(daysBack) || daysBack < 0 || daysBack > 30) {
    throw new Error(`--daysBack inválido: ${argMap.get("daysBack")}`);
  }
  if (!Number.isFinite(limit) || limit <= 0 || limit > 100) {
    throw new Error(`--limit inválido: ${argMap.get("limit")}`);
  }
  return { date, daysForward, daysBack, limit };
}

function shiftDate(iso: string, deltaDays: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().split("T")[0];
}

function todayString(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * readiness_score:
 *   sample 1 → 1pt   (ruído, pouco peso)
 *   sample 2 → 3pts  (já indica tendência)
 *   sample 3+ → 6pts (sample útil para o motor v0.1)
 *
 * Normalizado por 22 (titulares) × 6pts = 132. clamp [0,1].
 */
function computeReadinessScore(args: {
  sample_1: number;
  sample_2: number;
  sample_3_plus: number;
}): number {
  const pts =
    args.sample_1 * 1 + args.sample_2 * 3 + args.sample_3_plus * 6;
  const max = 22 * 6;
  return Math.min(1, pts / max);
}

function recommend(args: {
  sample_2: number;
  sample_3_plus: number;
}): "bom candidato" | "monitorar" | "não rodar Player Intel ainda" {
  if (args.sample_3_plus >= 14) return "bom candidato";
  if (args.sample_2 + args.sample_3_plus >= 14) return "monitorar";
  return "não rodar Player Intel ainda";
}

interface FixtureRow {
  id: string;
  api_fixture_id: number;
  league_name: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  home_team_name: string | null;
  away_team_name: string | null;
  status: string | null;
  kickoff_at: string | null;
  date: string | null;
}

interface ScanResult {
  api_fixture_id: number;
  status: string;
  kickoff_at: string;
  league_name: string;
  match: string;
  sample_1: number;
  sample_2: number;
  sample_3_plus: number;
  total_player_stats: number;
  readiness_score: number;
  recommendation: string;
}

async function main() {
  const args = parseArgs();
  console.log(
    `→ readiness:player-intel daysBack=${args.daysBack} daysForward=${args.daysForward} limit=${args.limit} date=${args.date ?? "—"}\n`
  );

  const { getSupabaseAdmin } = await import("../lib/supabase/admin");
  const { PRIORITY_LEAGUE_NAMES } = await import(
    "../lib/player-intel/history-candidates"
  );
  const sb = getSupabaseAdmin();

  const today = todayString();
  const lowerDate = args.date ?? shiftDate(today, -args.daysBack);
  const upperDate = args.date ?? shiftDate(today, args.daysForward);

  console.log(
    `→ janela: ${lowerDate} a ${upperDate} | ligas: ${PRIORITY_LEAGUE_NAMES.join(", ")}\n`
  );

  const { data: fixturesRaw, error: fxErr } = await sb
    .from("football_fixtures")
    .select(
      "id, api_fixture_id, league_name, home_team_id, away_team_id, home_team_name, away_team_name, status, kickoff_at, date"
    )
    .gte("date", lowerDate)
    .lte("date", upperDate)
    .in("status", FIXTURE_STATUSES)
    .in("league_name", PRIORITY_LEAGUE_NAMES as readonly string[] as string[])
    .order("kickoff_at", { ascending: true })
    .limit(Math.max(args.limit * 5, 100));
  if (fxErr) throw new Error(`fixtures query: ${fxErr.message}`);

  const fixtures = (fixturesRaw ?? []) as FixtureRow[];
  if (fixtures.length === 0) {
    console.log("(nenhum fixture na janela com ligas prioritárias)");
    process.exit(0);
  }

  const results: ScanResult[] = [];

  for (const fx of fixtures) {
    const teamIds = [fx.home_team_id, fx.away_team_id].filter(
      (id): id is string => !!id
    );
    if (teamIds.length === 0) continue;

    const { data: stats, error: stErr } = await sb
      .from("football_player_match_stats")
      .select("api_player_id, fixture_id, team_id")
      .in("team_id", teamIds)
      .gt("api_player_id", 0);
    if (stErr) {
      console.warn(
        `  fixture ${fx.api_fixture_id}: erro ao ler stats — ${stErr.message}`
      );
      continue;
    }

    // Distinct fixture_ids por jogador (sample_size por jogador).
    const fixturesByPlayer = new Map<number, Set<string>>();
    for (const r of stats ?? []) {
      const apiId = r.api_player_id as number;
      if (!fixturesByPlayer.has(apiId)) fixturesByPlayer.set(apiId, new Set());
      fixturesByPlayer.get(apiId)!.add(r.fixture_id as string);
    }
    let sample_1 = 0;
    let sample_2 = 0;
    let sample_3_plus = 0;
    for (const set of fixturesByPlayer.values()) {
      const n = set.size;
      if (n === 1) sample_1++;
      else if (n === 2) sample_2++;
      else if (n >= 3) sample_3_plus++;
    }

    const score = computeReadinessScore({ sample_1, sample_2, sample_3_plus });
    const rec = recommend({ sample_2, sample_3_plus });

    results.push({
      api_fixture_id: fx.api_fixture_id,
      status: fx.status ?? "?",
      kickoff_at: fx.kickoff_at ?? "?",
      league_name: fx.league_name ?? "?",
      match: `${fx.home_team_name ?? "?"} × ${fx.away_team_name ?? "?"}`,
      sample_1,
      sample_2,
      sample_3_plus,
      total_player_stats: stats?.length ?? 0,
      readiness_score: Math.round(score * 1000) / 1000,
      recommendation: rec,
    });
  }

  // Ordena por score desc, depois kickoff asc.
  results.sort((a, b) => {
    if (a.readiness_score !== b.readiness_score) {
      return b.readiness_score - a.readiness_score;
    }
    return a.kickoff_at.localeCompare(b.kickoff_at);
  });
  const top = results.slice(0, args.limit);

  console.log(
    `→ Fixtures escaneados: ${results.length} | exibindo top ${top.length}\n`
  );
  console.log(
    "score   sample1  sample2  sample3+  status  api_fixture_id  kickoff_at                liga                              jogo                                                   recomendação"
  );
  console.log(
    "-----   -------  -------  --------  ------  --------------  ------------------------  --------------------------------  ----------------------------------------------------  -----------------------------"
  );
  for (const r of top) {
    console.log(
      [
        r.readiness_score.toFixed(3).padStart(5),
        String(r.sample_1).padStart(7),
        String(r.sample_2).padStart(7),
        String(r.sample_3_plus).padStart(8),
        (r.status ?? "?").padEnd(6),
        String(r.api_fixture_id).padEnd(14),
        r.kickoff_at.padEnd(24),
        r.league_name.slice(0, 32).padEnd(32),
        r.match.slice(0, 52).padEnd(52),
        r.recommendation,
      ].join("  ")
    );
  }

  // Resumo agregado por recomendação
  const byRec = new Map<string, number>();
  for (const r of results) {
    byRec.set(r.recommendation, (byRec.get(r.recommendation) ?? 0) + 1);
  }
  console.log("\n→ Resumo por recomendação:");
  for (const [k, v] of byRec.entries()) {
    console.log(`   ${k.padEnd(32)} ${v}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("\n✗ Erro fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
