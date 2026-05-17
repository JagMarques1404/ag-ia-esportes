/**
 * Publish board picks — gera picks (safe/value) a partir do board do
 * dia e grava em public_picks + public_pick_legs. Fase E.0A.7.
 *
 *   npm run publish:board-picks -- --date=YYYY-MM-DD --dryRun=true
 *   npm run publish:board-picks -- --date=YYYY-MM-DD --dryRun=false
 *
 * Trava de segurança: só publica picks para fixtures que passam pelo
 * readiness gate como READY. WATCHLIST/BLOCKED ficam fora.
 *
 * Filtros adicionais no board:
 *   - recommendation = 'forte'
 *   - sample_size >= 4 (configurável via --minSample)
 *   - data_quality_score >= 0.70 (configurável via --minDq)
 *
 * Picks geradas:
 *   - safe: 3 ações de maior prob/dq (uma por jogador)
 *   - value: 4 ações com prob >= 0.55
 *   - status sempre 'draft' (publicação manual virá depois)
 *
 * NÃO chama API. NÃO toca em bets/banca.
 * NÃO usa odds — só probability + sample + dq.
 */
process.env.AG_IA_SCRIPT_MODE = "true";

import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), ".env.local"), override: true });

interface CliArgs {
  date: string;
  dryRun: boolean;
  minSample: number;
  minDq: number;
  /** Se true, status='published'. Default false → 'draft' (admin promove). */
  publish: boolean;
  /** Filtra fixtures cujo kickoff_at >= "HH:mm" BR no `date`. */
  fromTime: string | null;
  /** Filtra apenas fixtures com kickoff_at > agora (E.0A.11). */
  futureOnly: boolean;
  /** Força gravação como draft mesmo se readiness não for READY (E.0A.11). */
  forceDraft: boolean;
  /** Inclui watchlist como pick gravada (E.0A.11). */
  includeWatchlist: boolean;
}

function parseArgs(): CliArgs {
  const argMap = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([a-zA-Z][a-zA-Z0-9-]*)(?:=(.+))?$/);
    if (m) argMap.set(m[1], m[2] ?? "true");
  }
  const date = argMap.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("--date=YYYY-MM-DD é obrigatório.");
  }
  const dryRunRaw = argMap.get("dryRun");
  const dryRun = dryRunRaw === undefined ? true : dryRunRaw !== "false";
  const minSample = Number.parseInt(argMap.get("minSample") ?? "4", 10);
  const minDq = Number.parseFloat(argMap.get("minDq") ?? "0.70");
  const publish = argMap.get("publish") === "true";
  const fromTimeRaw = argMap.get("fromTime");
  const fromTime =
    fromTimeRaw && /^\d{2}:\d{2}$/.test(fromTimeRaw) ? fromTimeRaw : null;
  const futureOnly = argMap.get("futureOnly") === "true";
  const forceDraft = argMap.get("forceDraft") === "true";
  const includeWatchlist = argMap.get("includeWatchlist") === "true";
  return {
    date,
    dryRun,
    minSample: Number.isFinite(minSample) ? minSample : 4,
    minDq: Number.isFinite(minDq) ? minDq : 0.7,
    publish,
    fromTime,
    futureOnly,
    forceDraft,
    includeWatchlist,
  };
}

// ============================================================
// Main
// ============================================================

async function main() {
  const args = parseArgs();
  console.log(
    `→ publish-board-picks date=${args.date} dryRun=${args.dryRun} minSample=${args.minSample} minDq=${args.minDq} publish=${args.publish}\n`
  );

  const { getSupabaseAdmin } = await import("../lib/supabase/admin");
  const { evaluateFixtureReadinessForPick } = await import(
    "../lib/player-intel/readiness-gate"
  );
  const { buildPicksFromBoard, buildPicksPreview } = await import(
    "../lib/picks/build-from-board"
  );
  const sb = getSupabaseAdmin();

  // 1. Buscar fixtures do dia — robusto a timezone:
  //    (a) date='YYYY-MM-DD' OU (b) kickoff_at em [00:00-23:59 BR (UTC-3)].
  //    Algumas integrações salvam date com o dia UTC do kickoff; jogos
  //    BR após 21h podem cair em date='dia+1'. Sem esse OR, fixtures
  //    brasileiros somem do publish.
  const dayStartBrUtc = `${args.date}T03:00:00Z`; // 00:00 BR (-3)
  const nextDate = (() => {
    const d = new Date(`${args.date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().split("T")[0];
  })();
  const dayEndBrUtc = `${nextDate}T03:00:00Z`;

  // Lê catálogo de auto-pick (filtragem opcional — sem catálogo aceita tudo)
  const { data: catalogIds } = await sb
    .from("football_leagues_catalog")
    .select("api_league_id")
    .eq("is_auto_pick", true);
  const autoPickLeagueIds = (catalogIds ?? [])
    .map((r) => Number(r.api_league_id))
    .filter((n) => Number.isFinite(n));

  // Faz 2 queries (date OR kickoff_at range) e mescla por api_fixture_id
  // — supabase-js .or() com timestamp range é fragil; mais simples assim.
  function buildQuery() {
    let q = sb
      .from("football_fixtures")
      .select(
        "id, api_fixture_id, api_league_id, league_name, home_team_name, away_team_name, kickoff_at, date"
      )
      .order("kickoff_at", { ascending: true, nullsFirst: false });
    if (autoPickLeagueIds.length > 0) {
      q = q.in("api_league_id", autoPickLeagueIds);
    }
    return q;
  }

  const [byDate, byKickoff] = await Promise.all([
    buildQuery().eq("date", args.date),
    buildQuery().gte("kickoff_at", dayStartBrUtc).lt("kickoff_at", dayEndBrUtc),
  ]);
  if (byDate.error) {
    console.error(`✗ select fixtures (date): ${byDate.error.message}`);
    process.exit(1);
  }
  if (byKickoff.error) {
    console.error(`✗ select fixtures (kickoff): ${byKickoff.error.message}`);
    process.exit(1);
  }

  type FxRow = {
    id: string;
    api_fixture_id: number;
    api_league_id: number | null;
    league_name: string | null;
    home_team_name: string | null;
    away_team_name: string | null;
    kickoff_at: string | null;
    date: string | null;
  };
  const merged = new Map<number, FxRow>();
  for (const r of (byDate.data ?? []) as FxRow[]) merged.set(r.api_fixture_id, r);
  for (const r of (byKickoff.data ?? []) as FxRow[]) {
    if (!merged.has(r.api_fixture_id)) merged.set(r.api_fixture_id, r);
  }
  let allFx = Array.from(merged.values()).sort((a, b) => {
    const ka = a.kickoff_at ?? "";
    const kb = b.kickoff_at ?? "";
    return ka.localeCompare(kb);
  });

  // E.0A.11: filtros adicionais
  const totalBeforeTimeFilter = allFx.length;
  if (args.fromTime) {
    const cutoffBr = new Date(`${args.date}T${args.fromTime}:00-03:00`);
    allFx = allFx.filter((fx) => {
      if (!fx.kickoff_at) return false;
      return new Date(fx.kickoff_at) >= cutoffBr;
    });
  }
  if (args.futureOnly) {
    const now = new Date();
    allFx = allFx.filter(
      (fx) => fx.kickoff_at != null && new Date(fx.kickoff_at) > now
    );
  }

  console.log(
    `→ ${allFx.length} fixtures encontrados na data ${args.date}` +
      (autoPickLeagueIds.length > 0
        ? ` (filtrado por ${autoPickLeagueIds.length} ligas do catálogo auto_pick)`
        : " (catálogo vazio — sem filtro de liga)")
  );
  console.log(
    `   ↳ por date=${args.date}: ${(byDate.data ?? []).length}, por kickoff BR-day: ${(byKickoff.data ?? []).length}, filtrados temporalmente: ${totalBeforeTimeFilter - allFx.length}`
  );

  // 2. Avaliar readiness e filtrar READY (ou WATCHLIST se includeWatchlist)
  const eligible: Array<{
    fx: (typeof allFx)[number];
    gateLevel: "READY" | "WATCHLIST" | "BLOCKED";
  }> = [];
  for (const fx of allFx) {
    try {
      const gate = await evaluateFixtureReadinessForPick(fx.api_fixture_id);
      const label =
        gate.level === "READY"
          ? "✓ READY"
          : gate.level === "WATCHLIST"
            ? "◐ WATCHLIST"
            : "✗ BLOCKED";
      console.log(
        `   ${label.padEnd(15)} ${fx.api_fixture_id}  ${fx.home_team_name} × ${fx.away_team_name}`
      );
      const shouldInclude =
        gate.level === "READY" ||
        (args.includeWatchlist && gate.level === "WATCHLIST") ||
        (args.forceDraft && gate.level !== "BLOCKED");
      if (shouldInclude) eligible.push({ fx, gateLevel: gate.level });
    } catch (err) {
      console.warn(
        `   ⚠ gate falhou para ${fx.api_fixture_id}: ${err instanceof Error ? err.message : err}`
      );
    }
  }
  const readyFx = eligible.map((e) => e.fx);

  console.log(
    `\n→ ${readyFx.length} fixture(s) elegíveis (forceDraft=${args.forceDraft}, includeWatchlist=${args.includeWatchlist})`
  );
  if (readyFx.length === 0) {
    console.log("   (nada a publicar)");
    process.exit(0);
  }

  // 3. Para cada READY, ler probs + montar picks via helper
  const status: "draft" | "published" = args.publish ? "published" : "draft";
  const summary: Array<{
    api_fixture_id: number;
    match_name: string;
    safe_legs: number;
    value_legs: number;
    watchlist_legs: number;
    published: number;
  }> = [];

  for (const fx of readyFx) {
    console.log(
      `\n→ ${fx.api_fixture_id}  ${fx.home_team_name} × ${fx.away_team_name}`
    );
    const matchName = `${fx.home_team_name} × ${fx.away_team_name}`;

    const result = args.dryRun
      ? await buildPicksPreview({
          api_fixture_id: fx.api_fixture_id,
          pick_date: args.date,
          league_name: fx.league_name,
          match_name: matchName,
          kickoff_at: fx.kickoff_at,
          status,
          min_sample: args.minSample,
          min_data_quality: args.minDq,
        })
      : await buildPicksFromBoard({
          api_fixture_id: fx.api_fixture_id,
          pick_date: args.date,
          league_name: fx.league_name,
          match_name: matchName,
          kickoff_at: fx.kickoff_at,
          status,
          min_sample: args.minSample,
          min_data_quality: args.minDq,
        });

    console.log(
      `   safe=${result.safe_legs.length}, value=${result.value_legs.length}, watchlist=${result.watchlist_legs.length}`
    );
    for (const l of result.safe_legs) {
      console.log(
        `     [safe]  ${l.player_name.padEnd(22)} ${l.market.padEnd(35)} p=${l.probability.toFixed(2)} n=${l.sample_size} dq=${l.data_quality_score.toFixed(2)}`
      );
    }
    for (const l of result.value_legs) {
      console.log(
        `     [value] ${l.player_name.padEnd(22)} ${l.market.padEnd(35)} p=${l.probability.toFixed(2)} n=${l.sample_size} dq=${l.data_quality_score.toFixed(2)}`
      );
    }
    for (const n of result.notes) console.log(`     ⚠ ${n}`);

    const publishedCount =
      (result.safe_pick_id ? 1 : 0) + (result.value_pick_id ? 1 : 0);

    summary.push({
      api_fixture_id: fx.api_fixture_id,
      match_name: matchName,
      safe_legs: result.safe_legs.length,
      value_legs: result.value_legs.length,
      watchlist_legs: result.watchlist_legs.length,
      published: publishedCount,
    });
  }

  console.log("\n=== Resumo ===");
  for (const s of summary) {
    console.log(
      `  ${s.api_fixture_id}  ${s.match_name.padEnd(35)} safe=${s.safe_legs} value=${s.value_legs} watch=${s.watchlist_legs} ${args.dryRun ? "[dryRun]" : `picks=${s.published}`}`
    );
  }

  if (args.dryRun) {
    console.log("\n[dryRun] sem writes. Para publicar:");
    console.log(
      `   npm run publish:board-picks -- --date=${args.date} --dryRun=false`
    );
    console.log(
      `   (status='draft' por padrão; --publish=true grava como 'published')`
    );
  } else {
    console.log(
      `\nPicks gravadas em public_picks com status='${status}'. Para promover drafts manualmente, atualize status='published' no banco.`
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("\n✗ Erro fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
