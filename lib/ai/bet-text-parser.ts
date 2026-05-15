/**
 * Parser determinístico para texto livre de aposta colado pelo usuário.
 * Tipicamente o conteúdo vem de um print/cópia da Bet365, Betano etc.
 *
 * Não é um LLM nem OCR — apenas regex com heurísticas estáveis.
 *
 * Exemplo de input que precisa funcionar:
 *
 *   Registra essa aposta no meu histórico:
 *
 *   Bet365
 *   Aston Villa x Liverpool
 *   Odd total: 1.95
 *   Stake: R$188,00
 *   Retorno potencial: R$367,04
 *
 *   Seleções:
 *   - Ollie Watkins: 2+ chutes
 *   - Cody Gakpo: 2+ chutes
 *   - Morgan Rogers: 1+ faltas sofridas
 *
 * Decisão: se não der pra extrair pelo menos { stake, odd, ≥1 leg }, retorna null —
 * isso libera o caller para cair no caminho antigo (pick contextual).
 */

export interface ParsedBetLeg {
  /** Texto bruto da linha original. */
  raw: string;
  /** Nome do jogador, se identificado (antes do separador). */
  player_name: string | null;
  /** Texto do mercado/seleção, ex.: "2+ chutes". */
  market: string;
  /** Linha numérica derivada de "N+" → (N - 0.5). null se não detectada. */
  line: number | null;
}

export interface ParsedFreeBet {
  /** Casa de aposta (Bet365, Betano, ...). null se não identificada. */
  bookmaker: string | null;
  /** "Aston Villa × Liverpool" — formatado com ×. */
  match_name: string | null;
  /** Odd combinada (ex.: 1.95). */
  combined_odd: number;
  /** Stake em R$ (ex.: 188.0). */
  total_stake: number;
  /** Retorno potencial declarado pela casa. null se ausente. */
  potential_return: number | null;
  /** Lucro líquido derivado: potential_return - total_stake (se conhecido). */
  potential_profit: number | null;
  /** Legs extraídas das linhas com "-" / "•" / "*". */
  legs: ParsedBetLeg[];
  /** Confiança 0..1 — quantos campos foram extraídos com sucesso. */
  confidence: number;
}

const KNOWN_BOOKMAKERS = [
  "Bet365",
  "Betano",
  "Sportingbet",
  "Pinnacle",
  "Betfair",
  "Superbet",
  "KTO",
  "Galera.bet",
  "Galera",
  "Stake",
  "Pixbet",
  "Esportes da Sorte",
  "Bet7k",
  "Betnacional",
  "Novibet",
  "F12.bet",
  "F12",
];

// ============================================================
// Regex
// ============================================================

const RE_BOOKMAKER_LINE = /^\s*(?:casa|bookmaker)\s*[:\-]\s*([A-Za-z0-9.\- ]+)\s*$/im;

// "Odd total:", "Odd combinada:", "odd:" — captura o número.
// Aceita 1 ou 2 dígitos antes do ponto/vírgula.
const RE_ODD_LABELED =
  /\b(?:odd(?:\s+(?:total|combinada))?|odds?)\s*[:\-]?\s*(\d{1,2}[.,]\d{1,2})\b/i;

// "Stake: R$188,00" / "Stake R$ 188" / "valor R$ 100"
const RE_STAKE =
  /\b(?:stake|valor(?:\s+apostado)?|aposta(?:do)?)\s*[:\-]?\s*R?\$?\s*(\d{1,6}(?:[.,]\d{1,2})?)/i;

// "Retorno potencial: R$367,04" / "Possível retorno R$367" / "Retorno R$ 367"
const RE_RETURN =
  /\b(?:retorno(?:\s+potencial)?|poss[ií]vel\s+retorno|payout)\s*[:\-]?\s*R?\$?\s*(\d{1,6}(?:[.,]\d{1,2})?)/i;

// Match "X x Y" / "X × Y" / "X vs Y" — letras com acento, hífen ou ponto.
const RE_MATCH =
  /([A-Za-zÀ-ÿ.\-]+(?:\s+[A-Za-zÀ-ÿ.\-]+){0,3})\s*(?:x|×|vs)\s+([A-Za-zÀ-ÿ.\-]+(?:\s+[A-Za-zÀ-ÿ.\-]+){0,3})/i;

// "2+", "1+" — usado para derivar a linha
const RE_PLUS_LINE = /(\d+)\s*\+/;

// ============================================================
// Helpers
// ============================================================

function parseBrlNumber(raw: string): number {
  // 188,00 → 188.00 / 1.95 → 1.95 / 1,234.56 → 1234.56
  const cleaned = raw.replace(/\s/g, "");
  // Se tem vírgula como decimal (formato BR), converte
  if (/,\d{1,2}$/.test(cleaned)) {
    return Number(cleaned.replace(/\./g, "").replace(",", "."));
  }
  return Number(cleaned.replace(/,/g, ""));
}

function findBookmaker(text: string): string | null {
  // 1. "Casa: X" / "Bookmaker: X"
  const labeled = RE_BOOKMAKER_LINE.exec(text);
  if (labeled) {
    const cand = labeled[1].trim();
    return cand.length > 0 ? cand : null;
  }
  // 2. Procurar por casas conhecidas em qualquer linha curta (≤ 30 chars)
  const lines = text.split(/\r?\n/);
  for (const ln of lines) {
    const trimmed = ln.trim();
    if (trimmed.length === 0 || trimmed.length > 30) continue;
    for (const bk of KNOWN_BOOKMAKERS) {
      // case-insensitive, palavra inteira
      const re = new RegExp(`\\b${bk.replace(/[.+]/g, "\\$&")}\\b`, "i");
      if (re.test(trimmed)) {
        // Normaliza para a forma canônica conhecida
        return bk;
      }
    }
  }
  return null;
}

function findMatchName(text: string): string | null {
  // Procura linha por linha — a primeira que casa com "X x Y" sem
  // palavras-chave de instrução vence.
  const lines = text.split(/\r?\n/);
  for (const ln of lines) {
    const trimmed = ln.trim();
    if (trimmed.length === 0) continue;
    // Pula linhas que parecem instruções/comandos
    if (
      /\b(registra|registrar|salva|salvar|adiciona|stake|odd|retorno|sele[cç][oõ]es|status)\b/i.test(
        trimmed
      )
    ) {
      continue;
    }
    const m = RE_MATCH.exec(trimmed);
    if (m) {
      const home = m[1].trim();
      const away = m[2].trim();
      // Filtra falsos positivos do tipo "vs" no meio de uma frase.
      if (home.length < 2 || away.length < 2) continue;
      return `${home} × ${away}`;
    }
  }
  return null;
}

function extractLegs(text: string): ParsedBetLeg[] {
  const legs: ParsedBetLeg[] = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const ln = raw.trim();
    // Inicia com -, •, *, –, —
    if (!/^[\-•*–—]\s+/.test(ln)) continue;
    const body = ln.replace(/^[\-•*–—]\s+/, "").trim();
    if (body.length === 0) continue;

    // "Player: market" ou "Player - market"
    let player: string | null = null;
    let market = body;
    const sepMatch = body.match(/^([^:\-–—]+?)\s*[:\-–—]\s+(.+)$/);
    if (sepMatch) {
      const cand = sepMatch[1].trim();
      // Player só conta se parecer nome próprio (≥ 2 palavras OU primeira letra maiúscula)
      if (
        cand.length >= 3 &&
        cand.length <= 40 &&
        /^[A-ZÀ-Ý]/.test(cand)
      ) {
        player = cand;
        market = sepMatch[2].trim();
      }
    }

    let line: number | null = null;
    const plus = RE_PLUS_LINE.exec(market);
    if (plus) {
      const n = Number.parseInt(plus[1], 10);
      if (Number.isFinite(n) && n > 0) {
        // "2+" significa over 1.5 (≥ 2). Linha = n - 0.5.
        line = n - 0.5;
      }
    }

    legs.push({ raw: ln, player_name: player, market, line });
  }
  return legs;
}

function findOdd(text: string): number | null {
  const m = RE_ODD_LABELED.exec(text);
  if (!m) return null;
  const n = parseBrlNumber(m[1]);
  return Number.isFinite(n) && n >= 1.01 && n <= 1000 ? n : null;
}

function findStake(text: string): number | null {
  const m = RE_STAKE.exec(text);
  if (!m) return null;
  const n = parseBrlNumber(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function findReturn(text: string): number | null {
  const m = RE_RETURN.exec(text);
  if (!m) return null;
  const n = parseBrlNumber(m[1]);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// ============================================================
// Entrypoint
// ============================================================

/**
 * Tenta extrair uma aposta a partir de texto livre. Retorna null se não
 * conseguir o mínimo (stake + odd + ≥ 1 leg). Caller deve usar o resultado
 * como fonte primária e cair no caminho antigo (pick contextual) só quando
 * o retorno for null.
 */
export function parseFreeBetText(input: string): ParsedFreeBet | null {
  if (!input || input.length < 10) return null;
  const text = input.trim();

  const odd = findOdd(text);
  const stake = findStake(text);
  const legs = extractLegs(text);

  // Mínimo necessário para considerar uma "free bet" parsável.
  if (odd == null || stake == null || legs.length === 0) return null;

  const bookmaker = findBookmaker(text);
  const match_name = findMatchName(text);
  const potential_return = findReturn(text);
  const potential_profit =
    potential_return != null
      ? Number((potential_return - stake).toFixed(2))
      : Number((stake * odd - stake).toFixed(2));

  // Confiança: 5 sinais possíveis (odd/stake/legs/match/bookmaker/return)
  let confidence = 0;
  if (odd != null) confidence += 0.25;
  if (stake != null) confidence += 0.25;
  if (legs.length > 0) confidence += 0.2;
  if (match_name) confidence += 0.15;
  if (bookmaker) confidence += 0.1;
  if (potential_return != null) confidence += 0.05;

  return {
    bookmaker,
    match_name,
    combined_odd: odd,
    total_stake: stake,
    potential_return,
    potential_profit,
    legs,
    confidence: Number(confidence.toFixed(2)),
  };
}
