import "@/lib/server-only-guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { classifyPlayerArchetype } from "./archetypes";
import {
  calculatePlayerRecentForm,
  upsertPlayerRecentForm,
  type PlayerRecentForm,
} from "./recent-form";
import {
  mapDirectMatchups,
  upsertPlayerMatchups,
  type DirectMatchup,
} from "./matchups";
import {
  PLAYER_ACTIONS,
  calculatePlayerActionProbability,
  upsertPlayerActionProbabilities,
  type PlayerActionProbability,
} from "./actions";
import { getMatchupBoosts } from "./matchup-matrix";

export interface FixturePlayerIntelResult {
  fixture_id: string;
  api_fixture_id: number;
  players_analyzed: number;
  matchups_built: number;
  probabilities_generated: number;
  data_quality_avg: number;
  warnings: string[];
  matchups: DirectMatchup[];
  probabilities: PlayerActionProbability[];
}

interface LineupPlayerRow {
  player_id: string | null;
  api_player_id: number | null;
  player_name: string | null;
  team_id: string | null;
  position: string | null;
  is_starting: boolean | null;
}

interface FixtureRow {
  id: string;
  api_fixture_id: number;
  home_team_id: string | null;
  away_team_id: string | null;
  date: string | null;
  kickoff_at: string | null;
}

/**
 * Pipeline completo de Player Intel para um fixture:
 *   1. Lê lineup_players titulares.
 *   2. Calcula recent_form de cada jogador (lê stats já no banco).
 *   3. Classifica arquétipo.
 *   4. Mapeia matchups diretos por zona.
 *   5. Para cada jogador, gera probabilidades das 11 ações.
 *   6. Persiste recent_form, matchups e action_probabilities.
 *
 * Não chama API-Football. Pré-requisitos no banco:
 *   - football_lineups + football_lineup_players (rode syncFixtureLineups)
 *   - football_player_match_stats (rode syncFixturePlayerStats — Fase 4)
 *
 * Sem stats, retorna sample=0 e prob~0 para todos. Sem lineup,
 * matchups=0 e o pipeline para limpo.
 */
export async function runFixturePlayerIntel(
  apiFixtureId: number
): Promise<FixturePlayerIntelResult> {
  const supabase = getSupabaseAdmin();
  const warnings: string[] = [];

  const { data: fx, error: fxError } = await supabase
    .from("football_fixtures")
    .select(
      "id, api_fixture_id, home_team_id, away_team_id, date, kickoff_at"
    )
    .eq("api_fixture_id", apiFixtureId)
    .maybeSingle<FixtureRow>();
  if (fxError) throw new Error(`runFixturePlayerIntel: ${fxError.message}`);
  if (!fx)
    throw new Error(
      `Fixture local não encontrada para api_fixture_id=${apiFixtureId}.`
    );

  const fixtureId = fx.id;
  const apiFx = fx.api_fixture_id;
  const fixtureDate = fx.date;
  const fixtureKickoffAt = fx.kickoff_at;

  const { data: lineupPlayers } = await supabase
    .from("football_lineup_players")
    .select(
      "player_id, api_player_id, player_name, team_id, position, is_starting"
    )
    .eq("fixture_id", fixtureId);

  const players = (lineupPlayers ?? []) as LineupPlayerRow[];
  if (players.length === 0) {
    warnings.push(
      "Sem lineups no banco para esse fixture. Rode syncFixtureLineups antes."
    );
    return {
      fixture_id: fixtureId,
      api_fixture_id: apiFx,
      players_analyzed: 0,
      matchups_built: 0,
      probabilities_generated: 0,
      data_quality_avg: 0,
      warnings,
      matchups: [],
      probabilities: [],
    };
  }

  // 1. Forma recente + arquétipo de cada jogador.
  const formByApiId = new Map<number, PlayerRecentForm>();
  const archetypeByApiId = new Map<number, string | null>();

  let dqSum = 0;
  let dqCount = 0;

  for (const lp of players) {
    if (!lp.api_player_id || !lp.player_id) continue;
    // Guard contra placeholder do provider. Sem isso, todos os
    // "Pedro Esli da Silva" do mundo viram um único cluster api=0.
    if (lp.api_player_id <= 0) {
      warnings.push(
        `Jogador ignorado por api_player_id inválido: ${lp.player_name ?? "?"} (id=${lp.api_player_id})`
      );
      continue;
    }
    let form: PlayerRecentForm;
    try {
      form = await calculatePlayerRecentForm({
        playerId: lp.player_id,
        apiPlayerId: lp.api_player_id,
        teamId: lp.team_id,
        // ANTI DATA-LEAKAGE: nunca usar o próprio fixture analisado
        // como histórico do jogador.
        excludeFixtureId: fixtureId,
        beforeKickoffAt: fixtureKickoffAt,
        beforeDate: fixtureDate ?? undefined,
      });
      await upsertPlayerRecentForm(form);
    } catch (err) {
      warnings.push(
        `recent_form falhou para api_player=${lp.api_player_id}: ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }
    formByApiId.set(lp.api_player_id, form);
    const arch = classifyPlayerArchetype({
      position: lp.position,
      sample_size: form.sample_size,
      shots_avg: form.shots_avg,
      shots_on_avg: form.shots_on_avg,
      fouls_committed_avg: form.fouls_committed_avg,
      fouls_drawn_avg: form.fouls_drawn_avg,
      tackles_avg: form.tackles_avg,
      interceptions_avg: form.interceptions_avg,
      cards_avg: form.cards_avg,
      key_passes_avg: form.key_passes_avg,
      crosses_avg: form.crosses_avg,
      duels_won_avg: form.duels_won_avg,
      duels_lost_avg: form.duels_lost_avg,
    });
    archetypeByApiId.set(lp.api_player_id, arch.archetype);

    if (form.sample_size > 0) {
      dqSum += form.sample_size <= 1 ? 0.2 : form.sample_size <= 3 ? 0.5 : 0.8;
      dqCount++;
    }
  }

  // 2. Mapear matchups e enriquecer com arquétipos + action_boosts.
  const baseMatchups = await mapDirectMatchups(fixtureId);
  const enrichedMatchups: DirectMatchup[] = baseMatchups.map((m) => {
    const myArc =
      m.api_player_id != null
        ? (archetypeByApiId.get(m.api_player_id) as DirectMatchup["player_archetype"])
        : null;
    const oppArc =
      m.opponent_api_player_id != null
        ? (archetypeByApiId.get(
            m.opponent_api_player_id
          ) as DirectMatchup["opponent_archetype"])
        : null;
    const action_boosts = getMatchupBoosts(myArc, oppArc);
    return {
      ...m,
      player_archetype: myArc,
      opponent_archetype: oppArc,
      explanation_json: {
        ...(m.explanation_json as Record<string, unknown>),
        player_archetype: myArc,
        opponent_archetype: oppArc,
        action_boosts,
      },
    };
  });
  await upsertPlayerMatchups(enrichedMatchups);

  // Index matchups por api_player_id para lookup rápido.
  const matchupByApiId = new Map<number, DirectMatchup>();
  for (const m of enrichedMatchups) {
    if (m.api_player_id != null) matchupByApiId.set(m.api_player_id, m);
  }

  // 3. Gerar probabilidades para todas as ações de todo titular,
  //    agora puxando série dos últimos 5 jogos por (jogador × ação).
  const { getPlayerLast5ActionSeries } = await import("./recent-form");
  const allProbs: PlayerActionProbability[] = [];
  for (const lp of players) {
    if (!lp.api_player_id) continue;
    const form = formByApiId.get(lp.api_player_id);
    if (!form) continue;
    const matchup = matchupByApiId.get(lp.api_player_id) ?? null;
    const opponentTeamId = matchup?.opponent_team_id ?? null;
    for (const action of PLAYER_ACTIONS) {
      // Série específica desta ação (já respeita anti-leakage via
      // beforeKickoffAt/excludeFixtureId herdados do fixture alvo).
      const series = await getPlayerLast5ActionSeries(
        lp.api_player_id,
        action,
        {
          limit: 5,
          excludeFixtureId: fixtureId,
          beforeKickoffAt: fixtureKickoffAt,
          beforeDate: fixtureDate ?? undefined,
        }
      ).catch(() => undefined);

      const prob = calculatePlayerActionProbability(
        {
          fixtureId,
          apiFixtureId: apiFx,
          player: {
            player_id: lp.player_id,
            api_player_id: lp.api_player_id,
            player_name: lp.player_name ?? "?",
            team_id: lp.team_id,
            is_starting: !!lp.is_starting,
          },
          opponentTeamId,
          form,
          matchup,
          series,
          // odd_market virá do board manual (UI) ou de fontes externas
          // — neste runner ainda não temos. Fica null por padrão.
          oddMarket: null,
        },
        action,
        0.5
      );
      allProbs.push(prob);
    }
  }
  await upsertPlayerActionProbabilities(allProbs);

  return {
    fixture_id: fixtureId,
    api_fixture_id: apiFx,
    players_analyzed: formByApiId.size,
    matchups_built: enrichedMatchups.length,
    probabilities_generated: allProbs.length,
    data_quality_avg: dqCount > 0 ? Number((dqSum / dqCount).toFixed(3)) : 0,
    warnings,
    matchups: enrichedMatchups,
    probabilities: allProbs,
  };
}
