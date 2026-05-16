/**
 * Seed manual de escalações previstas (Fase E.0A.4).
 *
 *   npm run seed:manual-lineups -- --dryRun=true
 *   npm run seed:manual-lineups -- --dryRun=false
 *   npm run seed:manual-lineups -- --dryRun=false --generateBoards=true
 *
 * Insere escalações previstas em football_lineups + football_lineup_players
 * marcando source='manual_predicted' (Migration 015). Nunca chama API.
 *
 * Para jogos com api_fixture_id direto, resolve pelo ID.
 * Para jogos sem ID, faz lookup em football_fixtures por (date, match_name).
 *
 * Jogadores ganham `api_player_id` sintético determinístico no range
 * 800_000_000..999_999_999 (hash do nome+team) — não colide com IDs
 * reais do provider e permite o pipeline existente rodar.
 *
 * --generateBoards=true: depois do upsert, roda runFixturePlayerIntel
 * para cada fixture seedado. Sample sempre 0 (sem histórico) → board
 * sai como watchlist. Não publica public_picks automaticamente.
 */
process.env.AG_IA_SCRIPT_MODE = "true";

import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), ".env.local"), override: true });

// ============================================================
// DADOS — 21 jogos
// ============================================================

interface ManualMatchInput {
  /** Identificador humano para logs. */
  label: string;
  /** Se conhecido, pula lookup por nome. */
  api_fixture_id?: number;
  date: string;                 // YYYY-MM-DD (para lookup)
  league_hint?: string;         // ajuda fuzzy lookup
  home_team_name: string;
  away_team_name: string;
  home_formation: string;
  home_players_raw: string;     // "M. Flekken; E. Tapsoba, R. Andrich, J. Quansah; ..."
  away_formation: string;
  away_players_raw: string;
}

const MATCHES: ManualMatchInput[] = [
  // ---- 16/05/2026 — com api_fixture_id ----
  {
    label: "Bayer Leverkusen × Hamburger SV",
    api_fixture_id: 1388605,
    date: "2026-05-16",
    league_hint: "Bundesliga",
    home_team_name: "Bayer Leverkusen",
    away_team_name: "Hamburger SV",
    home_formation: "3-4-2-1",
    home_players_raw:
      "M. Flekken; E. Tapsoba, R. Andrich, J. Quansah; A. Grimaldo, A. Garcia, E. Palacios, M. Culbreath; E. Poku, I. Maza; P. Schick.",
    away_formation: "3-4-1-2",
    away_players_raw:
      "D. Fernandes; W. Omari, L. Vušković, N. Capaldo; A. Grønbæk, A. Sambi Lokonga, N. Remberg, B. Jatta; F. Vieira; R. Königsdörffer, O. Stange.",
  },
  {
    label: "Bayern München × 1. FC Köln",
    api_fixture_id: 1388606,
    date: "2026-05-16",
    league_hint: "Bundesliga",
    home_team_name: "Bayern München",
    away_team_name: "1. FC Köln",
    home_formation: "4-2-3-1",
    home_players_raw:
      "J. Urbig; J. Stanišić, D. Upamecano, H. Ito, T. Bischof; J. Kimmich, A. Pavlović; M. Olise, J. Musiala, L. Díaz; H. Kane.",
    away_formation: "4-3-3",
    away_players_raw:
      "M. Schwäbe; K. Lund, C. Özkaçar, J. Schmied, S. Sebulonsen; T. Krauß, J. Kamiński, I. Jóhannesson; S. El Mala, M. Bülter, L. Maina.",
  },
  {
    label: "Borussia Mönchengladbach × 1899 Hoffenheim",
    api_fixture_id: 1388607,
    date: "2026-05-16",
    league_hint: "Bundesliga",
    home_team_name: "Borussia Mönchengladbach",
    away_team_name: "1899 Hoffenheim",
    home_formation: "3-1-4-2",
    home_players_raw:
      "M. Nicolas; P. Sander, N. Elvedi, K. Diks; Y. Engelhardt; J. Scally, R. Reitz, K. Stöger, L. Ullrich; F. Honorat, S. Machino.",
    away_formation: "4-2-3-1",
    away_players_raw:
      "O. Baumann; Bernardo, A. Hajdari, O. Kabak, V. Coufal; W. Burger, L. Avdullahu; B. Touré, A. Kramarić, T. Lemperle; F. Asllani.",
  },
  {
    label: "Eintracht Frankfurt × VfB Stuttgart",
    api_fixture_id: 1388608,
    date: "2026-05-16",
    league_hint: "Bundesliga",
    home_team_name: "Eintracht Frankfurt",
    away_team_name: "VfB Stuttgart",
    home_formation: "4-2-3-1",
    home_players_raw:
      "M. Zetterer; A. Amenda, R. Koch, A. Theate, N. Brown; E. Skhiri, M. Dahoud; R. Doan, C. Uzun, F. Chaïbi; A. Kalimuendo.",
    away_formation: "3-5-2",
    away_players_raw:
      "A. Nübel; R. Hendriks, J. Chabot, M. Mittelstädt; C. Führich, N. Nartey, A. Stiller, C. Andrés, J. Leweling; D. Undav, E. Demirović.",
  },
  {
    label: "SC Freiburg × RB Leipzig",
    api_fixture_id: 1388609,
    date: "2026-05-16",
    league_hint: "Bundesliga",
    home_team_name: "SC Freiburg",
    away_team_name: "RB Leipzig",
    home_formation: "4-2-3-1",
    home_players_raw:
      "N. Atubolu; L. Kübler, M. Ginter, B. Ogbus, P. Treu; M. Eggestein, V. Grifo; N. Beste, L. Höler, J. Manzambi; I. Matanović.",
    away_formation: "4-3-3",
    away_players_raw:
      "M. Vandevoordt; D. Raum, C. Lukeba, W. Orbán, R. Baku; C. Baumgartner, X. Schlager, N. Seiwald; A. Nusa, Rômulo, Y. Diomande.",
  },
  {
    label: "1. FC Heidenheim × FSV Mainz 05",
    api_fixture_id: 1388610,
    date: "2026-05-16",
    league_hint: "Bundesliga",
    home_team_name: "1. FC Heidenheim",
    away_team_name: "FSV Mainz 05",
    home_formation: "4-3-3",
    home_players_raw:
      "F. Feller; O. Traoré, P. Mainka, J. Föhrenbach, H. Behrens; J. Schöppner, A. Ibrahimović, N. Dorsch; M. Pieringer, B. Zivzivadze, E. Dinkçi.",
    away_formation: "3-5-2",
    away_players_raw:
      "D. Batz; D. Kohr, S. Posch, K. Potulski; P. Mwene, K. Sano, P. Nebel, A. Caci; S. Becker, P. Tietz; N. Amiri.",
  },
  {
    label: "FC St. Pauli × VfL Wolfsburg",
    api_fixture_id: 1388611,
    date: "2026-05-16",
    league_hint: "Bundesliga",
    home_team_name: "FC St. Pauli",
    away_team_name: "VfL Wolfsburg",
    home_formation: "3-4-2-1",
    home_players_raw:
      "N. Vasilj; T. Ando, E. Smith, L. Ritzka; A. Pyrka, J. Irvine, C. Metcalfe, L. Oppie; A. Hountondji, J. Fujita; M. Kaars.",
    away_formation: "3-5-2",
    away_players_raw:
      "K. Grabara; K. Koulierakis, D. Vavro, J. Belocian; J. Mæhle, C. Eriksen, V. Souza, P. Wimmer, S. Kumbedi; A. Daghim, D. Pejčinović.",
  },
  {
    label: "Union Berlin × FC Augsburg",
    api_fixture_id: 1388612,
    date: "2026-05-16",
    league_hint: "Bundesliga",
    home_team_name: "Union Berlin",
    away_team_name: "FC Augsburg",
    home_formation: "4-2-3-1",
    home_players_raw:
      "C. Klaus; C. Trimmel, D. Leite, D. Doekhi, T. Rothe; R. Khedira, A. Kemlein; O. Burke, I. Ansah, L. Burcu; A. Ilić.",
    away_formation: "3-4-2-1",
    away_players_raw:
      "F. Dahmen; C. Zesiger, J. Gouweleeuw, C. Matsima; R. Fellhauer, F. Rieder, H. Massengo, M. Wolf; M. Kömür, A. Kade; M. Gregoritsch.",
  },
  {
    label: "Werder Bremen × Borussia Dortmund",
    api_fixture_id: 1388613,
    date: "2026-05-16",
    league_hint: "Bundesliga",
    home_team_name: "Werder Bremen",
    away_team_name: "Borussia Dortmund",
    home_formation: "4-3-3",
    home_players_raw:
      "M. Backhaus; I. Schmidt, A. Pieper, M. Friedl, O. Deman; C. Puertas, S. Lynen, J. Stage; J. Njinmah, S. Musah, R. Schmid.",
    away_formation: "3-4-2-1",
    away_players_raw:
      "G. Kobel; N. Schlotterbeck, W. Anton, J. Ryerson; M. Beier, J. Bellingham, M. Sabitzer, L. Reggiani; S. Inácio, J. Brandt; S. Guirassy.",
  },
  {
    label: "Internacional × Vasco da Gama",
    api_fixture_id: 1492267,
    date: "2026-05-16",
    league_hint: "Serie A",
    home_team_name: "Internacional",
    away_team_name: "Vasco da Gama",
    home_formation: "4-2-3-1",
    home_players_raw:
      "S. Rochet; B. Gomes, C. Sampaio, Juninho, M. Bahia; B. Henrique, R. Villagra; Vitinho, A. Patrick, J. Carbonero; Alerrandro.",
    away_formation: "4-2-3-1",
    away_players_raw:
      "L. Jardim; L. Piton, R. Renan, C. Cuesta, J. Rodríguez; H. Moura, C. Barros; A. Gómez, T. Tchê, Adson; C. Spinelli.",
  },
  {
    label: "Atlético-MG × Mirassol",
    api_fixture_id: 1492261,
    date: "2026-05-16",
    league_hint: "Serie A",
    home_team_name: "Atlético-MG",
    away_team_name: "Mirassol",
    home_formation: "4-2-3-1",
    home_players_raw:
      "Everson; Natanael, Lyanco, J. Alonso, R. Lodi; Maycon, A. Franco; T. Cuello, A. Minda, Bernard; M. Cássierra.",
    away_formation: "4-2-3-1",
    away_players_raw:
      "Walter; Reinaldo, W. Machado, J. Victor, D. Borges; N. Moura, J. Aldo; Alesson, Shalyon, G. Eduardo; E. Carioca.",
  },
  {
    label: "Fluminense × São Paulo",
    api_fixture_id: 1492266,
    date: "2026-05-16",
    league_hint: "Serie A",
    home_team_name: "Fluminense",
    away_team_name: "São Paulo",
    home_formation: "4-2-3-1",
    home_players_raw:
      "Fábio; Guga, Jemmes, J. Freytes, G. Arana; F. Bernal, Hércules; A. Canobbio, L. Acosta, J. Savarino; J. Kennedy.",
    away_formation: "4-2-3-1",
    away_players_raw:
      "Rafael; E. Díaz, Sabino, M. Dória, C. Soares; Danielzinho, D. Bobadilla; Ferreira, Luciano, Artur; A. Silva.",
  },

  // ---- Sem api_fixture_id — lookup por (date, match_name) ----
  {
    label: "Palmeiras × Cruzeiro",
    date: "2026-05-16",
    league_hint: "Serie A",
    home_team_name: "Palmeiras",
    away_team_name: "Cruzeiro",
    home_formation: "4-4-2",
    home_players_raw:
      "C. Miguel; A. Giay, G. Gómez, Murilo, Jefté; Maurício, A. Pereira, M. Freitas, U. Arias; R. Sosa, J. López.",
    away_formation: "4-2-3-1",
    away_players_raw:
      "Otávio; Kaiki, J. Jesus, F. Bruno, Fagner; L. Romero, M. Pereira; L. Sinisterra, Gerson, K. Arroyo; K. Jorge.",
  },
  {
    label: "Chelsea × Manchester City",
    date: "2026-05-16",
    league_hint: "FA Cup",
    home_team_name: "Chelsea",
    away_team_name: "Manchester City",
    home_formation: "4-2-3-1",
    home_players_raw:
      "F. Jørgensen; R. James, W. Fofana, T. Chalobah, M. Cucurella; M. Caicedo, E. Fernández; C. Palmer, A. Santos, P. Neto; J. Pedro.",
    away_formation: "4-2-3-1",
    away_players_raw:
      "J. Trafford; N. O'Reilly, M. Guéhi, A. Khusanov, M. Nunes; B. Silva, Rodri; J. Doku, R. Cherki, A. Semenyo; E. Haaland.",
  },
  {
    label: "Manchester United × Nottingham Forest",
    date: "2026-05-17",
    league_hint: "Premier League",
    home_team_name: "Manchester United",
    away_team_name: "Nottingham Forest",
    home_formation: "4-2-3-1",
    home_players_raw:
      "S. Lammens; N. Mazraoui, H. Maguire, L. Martínez, L. Shaw; M. Mount, K. Mainoo; A. Diallo, B. Fernandes, M. Cunha; J. Zirkzee.",
    away_formation: "3-5-2",
    away_players_raw:
      "M. Sels; Morato, N. Milenković, N. Williams; L. Netz, E. Anderson, N. Domínguez, D. Bakwa, J. Cunha; T. Awoniyi, I. Jesus.",
  },
  {
    label: "Como × Parma",
    date: "2026-05-17",
    league_hint: "Serie A",
    home_team_name: "Como",
    away_team_name: "Parma",
    home_formation: "4-2-3-1",
    home_players_raw:
      "J. Butez; M. Vojvoda, M. Kempf, D. Carlos, A. Moreno; M. Perrone, C. da Cunha; A. Diao, N. Paz, J. Rodríguez; T. Douvikas.",
    away_formation: "3-5-2",
    away_players_raw:
      "Z. Suzuki; L. Valenti, M. Troilo, A. Circati; E. Valeri, H. Nicolussi, M. Keita, C. Ordóñez, E. Delprato; N. Elphege, M. Pellegrino.",
  },
  {
    label: "AS Roma × Lazio",
    date: "2026-05-17",
    league_hint: "Serie A",
    home_team_name: "AS Roma",
    away_team_name: "Lazio",
    home_formation: "3-4-2-1",
    home_players_raw:
      "M. Svilar; G. Mancini, B. Cristante, E. Ndicka; Z. Çelik, M. Soulé, M. Koné, Wesley; D. Malen, P. Dybala; T. Noslin.",
    away_formation: "4-3-3",
    away_players_raw:
      "E. Motta; L. Pellegrini, O. Provstgaard, M. Gila, A. Marušić; F. Dele-Bashiru, N. Rovella, T. Bašić; Pedro, T. Noslin, M. Cancellieri.",
  },
  {
    label: "Genoa × AC Milan",
    date: "2026-05-17",
    league_hint: "Serie A",
    home_team_name: "Genoa",
    away_team_name: "AC Milan",
    home_formation: "3-4-2-1",
    home_players_raw:
      "J. Bijlow; A. Marcandalli, L. Østigård, N. Zätterström; M. Ellertsson, A. Amorim, M. Frendrup, A. Martín; J. Ekhator, Vitinha; L. Colombo.",
    away_formation: "3-5-2",
    away_players_raw:
      "M. Maignan; S. Pavlović, M. Gabbia, F. Tomori; D. Bartesaghi, A. Rabiot, S. Ricci, R. Loftus-Cheek, Z. Athekame; S. Giménez, C. Nkunku.",
  },
  {
    label: "Juventus × Fiorentina",
    date: "2026-05-17",
    league_hint: "Serie A",
    home_team_name: "Juventus",
    away_team_name: "Fiorentina",
    home_formation: "4-2-3-1",
    home_players_raw:
      "M. Di Gregorio; P. Kalulu, Bremer, L. Kelly, A. Cambiaso; M. Locatelli, T. Koopmeiners; F. Conceição, W. McKennie, K. Yıldız; D. Vlahović.",
    away_formation: "4-3-3",
    away_players_raw:
      "D. De Gea; R. Gosens, L. Ranieri, M. Pongračić, Dodô; C. Ndour, N. Fagioli, R. Mandragora; M. Solomon, R. Braschi, F. Parisi.",
  },
  {
    label: "Pisa × Napoli",
    date: "2026-05-17",
    league_hint: "Serie A",
    home_team_name: "Pisa",
    away_team_name: "Napoli",
    home_formation: "3-5-2",
    home_players_raw:
      "A. Semper; S. Canestrelli, A. Caracciolo, A. Calabresi; I. Touré, I. Vural, E. Akinsanmiro, M. Højlholt, M. Léris; F. Stojiljković, S. Moreo.",
    away_formation: "3-4-2-1",
    away_players_raw:
      "V. Milinković-Savić; A. Buongiorno, A. Rrahmani, G. Di Lorenzo; M. Gutiérrez, S. McTominay, S. Lobotka, P. Mazzocchi; A. Santos, Giovane; R. Højlund.",
  },
  {
    label: "Inter de Milão × Verona",
    date: "2026-05-17",
    league_hint: "Serie A",
    home_team_name: "Inter de Milão",
    away_team_name: "Verona",
    home_formation: "3-5-2",
    home_players_raw:
      "J. Martínez; Y. Bisseck, F. Acerbi, A. Bastoni; A. Diouf, N. Barella, P. Sučić, H. Mkhitaryan, C. Augusto; M. Thuram, L. Martínez.",
    away_formation: "3-5-1-1",
    away_players_raw:
      "Montipò; N. Valentini, A. Edmonsson, V. Nelsson; M. Frese, A. Bernede, R. Gagliardini, J. Akpa Akpro, R. Belghali; T. Suslov; K. Bowie.",
  },
];

// ============================================================
// CLI
// ============================================================

interface CliArgs {
  dryRun: boolean;
  generateBoards: boolean;
}

function parseArgs(): CliArgs {
  const argMap = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([a-zA-Z][a-zA-Z0-9-]*)(?:=(.+))?$/);
    if (m) argMap.set(m[1], m[2] ?? "true");
  }
  const dryRunRaw = argMap.get("dryRun");
  const dryRun = dryRunRaw === undefined ? true : dryRunRaw !== "false";
  const gb = argMap.get("generateBoards");
  const generateBoards = gb === "true";
  return { dryRun, generateBoards };
}

// ============================================================
// Helpers
// ============================================================

interface ParsedPlayer {
  name: string;
  position: "G" | "D" | "M" | "F";
}

function parsePlayers(raw: string, formation: string): ParsedPlayer[] {
  // "4-2-3-1" → [4,2,3,1]. Total + 1 (GK) = 11.
  const parts = formation.split("-").map((s) => parseInt(s.trim(), 10));
  if (!parts.every((n) => Number.isFinite(n) && n > 0)) {
    throw new Error(`Formação inválida: "${formation}"`);
  }
  // Split por ; e , e remove ponto final.
  const tokens = raw
    .replace(/\.$/, "")
    .split(/[;,]/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (tokens.length === 0) {
    throw new Error("Sem jogadores no raw");
  }
  // Distribui posições: 1 GK + parts[0] D + (middle groups) M + parts[last] F
  const positions: ParsedPlayer["position"][] = ["G"];
  const def = parts[0];
  const fwd = parts[parts.length - 1];
  const mid = parts.slice(1, -1).reduce((a, b) => a + b, 0);
  for (let i = 0; i < def; i++) positions.push("D");
  for (let i = 0; i < mid; i++) positions.push("M");
  for (let i = 0; i < fwd; i++) positions.push("F");

  // Pode haver mismatch (escalação curta) — usa min.
  const n = Math.min(tokens.length, positions.length);
  return tokens.slice(0, n).map((name, i) => ({
    name,
    position: positions[i],
  }));
}

// Hash determinístico → range 800_000_000..999_999_999 (cabe em INTEGER).
function syntheticApiPlayerId(playerName: string, teamSlug: string): number {
  const s = `${playerName}|${teamSlug}`.toLowerCase().normalize("NFKD");
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  const positive = Math.abs(h) % 200_000_000;
  return 800_000_000 + positive;
}

function normName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// ============================================================
// Main
// ============================================================

async function main() {
  const args = parseArgs();
  console.log(
    `→ seed-manual-lineups dryRun=${args.dryRun} generateBoards=${args.generateBoards}\n`
  );

  const { getSupabaseAdmin } = await import("../lib/supabase/admin");
  const sb = getSupabaseAdmin();

  interface FixtureLocal {
    id: string;
    api_fixture_id: number | null;
    date: string | null;
    home_team_id: string | null;
    away_team_id: string | null;
    home_team_name: string | null;
    away_team_name: string | null;
    api_home_team_id: number | null;
    api_away_team_id: number | null;
  }

  /**
   * Se o fixture tem api_*_team_id mas não tem team_id (drift comum
   * quando o sync rodou antes dos teams estarem no banco), cria entries
   * em football_teams e amarra as FKs.
   */
  async function autoLinkFixtureTeams(
    fixture: FixtureLocal,
    inputHomeName: string,
    inputAwayName: string,
    dryRun: boolean
  ): Promise<FixtureLocal> {
    if (fixture.home_team_id && fixture.away_team_id) return fixture;
    const teamsToUpsert: Array<{ api_team_id: number; name: string }> = [];
    if (
      !fixture.home_team_id &&
      fixture.api_home_team_id != null &&
      fixture.api_home_team_id > 0
    ) {
      teamsToUpsert.push({
        api_team_id: fixture.api_home_team_id,
        name: fixture.home_team_name ?? inputHomeName,
      });
    }
    if (
      !fixture.away_team_id &&
      fixture.api_away_team_id != null &&
      fixture.api_away_team_id > 0
    ) {
      teamsToUpsert.push({
        api_team_id: fixture.api_away_team_id,
        name: fixture.away_team_name ?? inputAwayName,
      });
    }
    if (teamsToUpsert.length === 0) return fixture;
    if (dryRun) {
      console.log(
        `   ℹ auto-link pendente: ${teamsToUpsert.length} team(s) seriam criados em football_teams`
      );
      return fixture;
    }
    const { error: tErr } = await sb
      .from("football_teams")
      .upsert(teamsToUpsert, { onConflict: "api_team_id" });
    if (tErr) {
      console.warn(`   ⚠ auto-link teams falhou: ${tErr.message}`);
      return fixture;
    }
    const apiIds = teamsToUpsert.map((t) => t.api_team_id);
    const { data: locals } = await sb
      .from("football_teams")
      .select("id, api_team_id")
      .in("api_team_id", apiIds);
    const idByApi = new Map<number, string>();
    for (const t of locals ?? [])
      if (t.api_team_id != null) idByApi.set(t.api_team_id, t.id as string);

    const updates: Record<string, string> = {};
    if (!fixture.home_team_id && fixture.api_home_team_id != null) {
      const v = idByApi.get(fixture.api_home_team_id);
      if (v) updates.home_team_id = v;
    }
    if (!fixture.away_team_id && fixture.api_away_team_id != null) {
      const v = idByApi.get(fixture.api_away_team_id);
      if (v) updates.away_team_id = v;
    }
    if (Object.keys(updates).length > 0) {
      await sb.from("football_fixtures").update(updates).eq("id", fixture.id);
      console.log(
        `   ✓ auto-link teams: ${Object.keys(updates).join(", ")}`
      );
      return {
        ...fixture,
        home_team_id: updates.home_team_id ?? fixture.home_team_id,
        away_team_id: updates.away_team_id ?? fixture.away_team_id,
      };
    }
    return fixture;
  }

  async function resolveFixture(
    input: ManualMatchInput
  ): Promise<{ fixture: FixtureLocal | null; ambiguous: number; candidates?: Array<{ home: string | null; away: string | null; api_fixture_id: number | null }> }> {
    if (input.api_fixture_id) {
      const { data } = await sb
        .from("football_fixtures")
        .select(
          "id, api_fixture_id, date, home_team_id, away_team_id, home_team_name, away_team_name, api_home_team_id, api_away_team_id"
        )
        .eq("api_fixture_id", input.api_fixture_id)
        .maybeSingle();
      return { fixture: (data as FixtureLocal) ?? null, ambiguous: 0 };
    }

    // Lookup por data ± 1 dia (tolerância de timezone)
    const d = input.date;
    const prev = shiftDate(d, -1);
    const next = shiftDate(d, 1);
    const { data: candidates } = await sb
      .from("football_fixtures")
      .select(
        "id, api_fixture_id, date, home_team_id, away_team_id, home_team_name, away_team_name, api_home_team_id, api_away_team_id, league_name"
      )
      .gte("date", prev)
      .lte("date", next);

    const wantedHome = normName(input.home_team_name);
    const wantedAway = normName(input.away_team_name);

    function teamMatches(actual: string, wanted: string): boolean {
      if (!actual || !wanted) return false;
      if (actual === wanted) return true;
      // Substring em qualquer direção (≥ 4 chars)
      const w = wanted.length >= 4 ? wanted : wanted + "xxx";
      const a = actual.length >= 4 ? actual : actual + "xxx";
      if (a.includes(w) || w.includes(a)) return true;
      // Última palavra do wanted casa com substring de actual
      const lastWord = wanted.match(/[a-z]{4,}$/)?.[0];
      if (lastWord && actual.includes(lastWord)) return true;
      return false;
    }

    const matches = (candidates ?? []).filter((c) => {
      const ch = normName((c.home_team_name as string | null) ?? "");
      const ca = normName((c.away_team_name as string | null) ?? "");
      return teamMatches(ch, wantedHome) && teamMatches(ca, wantedAway);
    });
    if (matches.length === 1) {
      return { fixture: matches[0] as FixtureLocal, ambiguous: 0 };
    }
    if (matches.length > 1) {
      return {
        fixture: null,
        ambiguous: matches.length,
        candidates: matches.map((c) => ({
          home: (c.home_team_name as string | null) ?? null,
          away: (c.away_team_name as string | null) ?? null,
          api_fixture_id: (c.api_fixture_id as number | null) ?? null,
        })),
      };
    }
    return { fixture: null, ambiguous: 0 };
  }

  function shiftDate(iso: string, deltaDays: number): string {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + deltaDays);
    return d.toISOString().split("T")[0];
  }

  const results: Array<{
    label: string;
    status: "ok" | "skipped" | "not_found" | "ambiguous" | "error";
    detail?: string;
    fixture_id?: string;
    api_fixture_id?: number;
    players_inserted?: number;
  }> = [];

  for (const input of MATCHES) {
    console.log(`\n→ ${input.label}`);

    const lookup = await resolveFixture(input);
    let fixture = lookup.fixture;
    if (!fixture) {
      const reason = lookup.ambiguous > 0 ? `ambíguo (${lookup.ambiguous} matches)` : "não encontrado";
      console.log(`   ✗ ${reason}`);
      if (lookup.candidates) {
        for (const c of lookup.candidates.slice(0, 5)) {
          console.log(`      candidato: ${c.home} × ${c.away}  (api=${c.api_fixture_id})`);
        }
      }
      results.push({
        label: input.label,
        status: lookup.ambiguous > 0 ? "ambiguous" : "not_found",
        detail: reason,
      });
      continue;
    }
    console.log(
      `   fixture local: ${fixture.id.slice(0, 8)}…  api=${fixture.api_fixture_id}  date=${fixture.date}`
    );

    // Auto-link teams quando home_team_id/away_team_id estão null
    const willAutoLink =
      (!fixture.home_team_id || !fixture.away_team_id) &&
      (fixture.api_home_team_id != null || fixture.api_away_team_id != null);
    if (!fixture.home_team_id || !fixture.away_team_id) {
      fixture = await autoLinkFixtureTeams(
        fixture,
        input.home_team_name,
        input.away_team_name,
        args.dryRun
      );
    }
    if (!fixture.home_team_id || !fixture.away_team_id) {
      if (args.dryRun && willAutoLink) {
        // Em dryRun com auto-link pendente, segue como "ok" — relata e pula a gravação.
        console.log(`   [dryRun] auto-link aconteceria em real — segue como ok`);
      } else {
        console.log(
          `   ✗ fixture sem home/away_team_id e sem api_*_team_id — pulando`
        );
        results.push({
          label: input.label,
          status: "skipped",
          detail: "fixture sem team_ids e sem api_team_ids",
          fixture_id: fixture.id,
        });
        continue;
      }
    }

    let homePlayers: ParsedPlayer[];
    let awayPlayers: ParsedPlayer[];
    try {
      homePlayers = parsePlayers(input.home_players_raw, input.home_formation);
      awayPlayers = parsePlayers(input.away_players_raw, input.away_formation);
    } catch (err) {
      console.log(
        `   ✗ parse falhou: ${err instanceof Error ? err.message : err}`
      );
      results.push({ label: input.label, status: "error", detail: "parse" });
      continue;
    }
    console.log(
      `   parsed: ${homePlayers.length} home / ${awayPlayers.length} away`
    );

    if (args.dryRun) {
      console.log(`   [dryRun] não grava`);
      results.push({
        label: input.label,
        status: "ok",
        detail: `dryRun (${homePlayers.length + awayPlayers.length} players)`,
        fixture_id: fixture.id,
        api_fixture_id: fixture.api_fixture_id ?? undefined,
      });
      continue;
    }

    // ============================================================
    // GRAVAÇÃO real
    // ============================================================
    try {
      // 1. Refresh: deleta lineups (cascade derruba lineup_players) APENAS
      //    se source for manual_predicted ou não existir ainda. Não toca
      //    em lineups vindas da API.
      await sb
        .from("football_lineups")
        .delete()
        .eq("fixture_id", fixture.id)
        .in("source", ["manual_predicted", "manual_confirmed"]);

      // 2. Para cada team, gera players, upsert football_players, INSERT
      //    football_lineups + football_lineup_players.
      let totalPlayers = 0;
      for (const side of ["home", "away"] as const) {
        const teamId = side === "home" ? fixture.home_team_id : fixture.away_team_id;
        const apiTeamId =
          side === "home" ? fixture.api_home_team_id : fixture.api_away_team_id;
        const teamName =
          side === "home"
            ? fixture.home_team_name ?? input.home_team_name
            : fixture.away_team_name ?? input.away_team_name;
        const players = side === "home" ? homePlayers : awayPlayers;
        const formation = side === "home" ? input.home_formation : input.away_formation;
        const teamSlug = normName(teamName);

        // Upsert football_players com api_player_id sintético
        const playerBasics = players.map((p) => ({
          api_player_id: syntheticApiPlayerId(p.name, teamSlug),
          name: p.name,
          current_team_id: teamId,
        }));
        // Dedupe defensivo dentro do mesmo time
        const seenApiIds = new Set<number>();
        const deduped = playerBasics.filter((p) => {
          if (seenApiIds.has(p.api_player_id)) return false;
          seenApiIds.add(p.api_player_id);
          return true;
        });
        const { error: pErr } = await sb
          .from("football_players")
          .upsert(deduped, { onConflict: "api_player_id" });
        if (pErr) throw new Error(`upsert players: ${pErr.message}`);

        // Resolver player_id local
        const apiIds = deduped.map((p) => p.api_player_id);
        const { data: locals } = await sb
          .from("football_players")
          .select("id, api_player_id")
          .in("api_player_id", apiIds);
        const playerIdByApi = new Map<number, string>();
        for (const lp of locals ?? [])
          if (lp.api_player_id != null)
            playerIdByApi.set(lp.api_player_id, lp.id as string);

        // 3. INSERT football_lineups
        const { data: lineupRow, error: lErr } = await sb
          .from("football_lineups")
          .insert({
            fixture_id: fixture.id,
            team_id: teamId,
            api_team_id: apiTeamId,
            formation,
            is_confirmed: false,
            source: "manual_predicted",
            raw_source: side === "home" ? input.home_players_raw : input.away_players_raw,
          })
          .select("id")
          .single();
        if (lErr || !lineupRow) throw new Error(`insert lineup ${side}: ${lErr?.message}`);

        // 4. INSERT football_lineup_players
        const lpRows = players.map((p) => ({
          lineup_id: lineupRow.id as string,
          fixture_id: fixture.id,
          team_id: teamId,
          api_player_id: syntheticApiPlayerId(p.name, teamSlug),
          player_id: playerIdByApi.get(syntheticApiPlayerId(p.name, teamSlug)) ?? null,
          player_name: p.name,
          position: p.position,
          grid: null,
          number: null,
          is_starting: true,
          source: "manual_predicted",
        }));
        const { error: lpErr } = await sb
          .from("football_lineup_players")
          .insert(lpRows);
        if (lpErr) throw new Error(`insert lineup_players ${side}: ${lpErr.message}`);

        totalPlayers += lpRows.length;
        console.log(`   ✓ ${side}: ${lpRows.length} players inseridos`);
      }

      results.push({
        label: input.label,
        status: "ok",
        fixture_id: fixture.id,
        api_fixture_id: fixture.api_fixture_id ?? undefined,
        players_inserted: totalPlayers,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`   ✗ erro: ${msg.slice(0, 200)}`);
      results.push({ label: input.label, status: "error", detail: msg.slice(0, 200) });
    }
  }

  // ============================================================
  // Relatório
  // ============================================================
  console.log("\n=== Resumo ===");
  const byStatus = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  for (const [k, v] of Object.entries(byStatus)) {
    console.log(`  ${k.padEnd(12)} ${v}`);
  }

  // ============================================================
  // --generateBoards
  // ============================================================
  if (args.generateBoards && !args.dryRun) {
    console.log("\n=== Gerando boards (runFixturePlayerIntel) ===");
    const { runFixturePlayerIntel } = await import("../lib/player-intel");
    for (const r of results) {
      if (r.status !== "ok" || !r.api_fixture_id) continue;
      console.log(`\n→ board ${r.api_fixture_id} ${r.label}`);
      try {
        const out = await runFixturePlayerIntel(r.api_fixture_id);
        console.log(
          `   ✓ ${out.players_analyzed} players · ${out.matchups_built} matchups · ${out.probabilities_generated} probs · dq=${out.data_quality_avg}`
        );
        if (out.warnings.length > 0) {
          for (const w of out.warnings.slice(0, 3)) {
            console.warn(`   ⚠ ${w}`);
          }
        }
      } catch (err) {
        console.warn(
          `   ✗ ${err instanceof Error ? err.message : err}`
        );
      }
    }
  } else if (args.generateBoards && args.dryRun) {
    console.log("\n[dryRun] --generateBoards ignorado em dryRun");
  }

  if (args.dryRun) {
    console.log("\n[dryRun] sem writes. Para aplicar:");
    console.log("   npm run seed:manual-lineups -- --dryRun=false");
    console.log("   npm run seed:manual-lineups -- --dryRun=false --generateBoards=true");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("\n✗ Erro fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
