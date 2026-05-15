// Parser determinístico de intenção. Sem LLM. Reconhece pt-BR
// usando palavras-chave e regex. Quando um provider de IA estiver
// configurado (Claude/Anthropic), este módulo será o "fallback"
// e o LLM passa a ser o caminho primário.

export type IntentType =
  | "explain_pick"
  | "build_combo"
  | "save_bet"
  | "update_bet"
  | "save_reminder"
  | "bankroll_info"
  | "risk_advice"
  | "fallback";

export interface ParsedIntent {
  type: IntentType;
  raw: string;
  /** Valor monetário detectado (R$). */
  amount?: number;
  /** Odd combinada alvo (ex.: 3.0). */
  oddTarget?: number;
  /** Trecho de texto que parece nome de partida ("Vitória x Flamengo"). */
  matchHint?: string;
  /** Janela em minutos para lembretes ("10 minutos antes"). */
  reminderMinutesBefore?: number;
}

const RE_AMOUNT_BRL =
  /(?:R\$\s*|\b)(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:reais?|R\$)?/i;
const RE_ODD = /\bodd\s*(\d{1,2}(?:[.,]\d{1,2})?)/i;
// "10 minutos antes", "1 hora antes", "30 min antes"
const RE_REMINDER_BEFORE =
  /(\d{1,3})\s*(min(?:utos?)?|h(?:oras?)?)\s*antes/i;
// pares de times com "x" ou "×" ou " vs "
const RE_MATCH_HINT =
  /([A-Za-zÀ-ÿ.\-]+(?:\s+[A-Za-zÀ-ÿ.\-]+){0,3})\s*(?:x|×|vs)\s*([A-Za-zÀ-ÿ.\-]+(?:\s+[A-Za-zÀ-ÿ.\-]+){0,3})/i;

function parseAmount(text: string): number | undefined {
  const m = RE_AMOUNT_BRL.exec(text);
  if (!m) return undefined;
  const raw = m[1].replace(",", ".");
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseOdd(text: string): number | undefined {
  const m = RE_ODD.exec(text);
  if (!m) return undefined;
  const n = Number.parseFloat(m[1].replace(",", "."));
  return Number.isFinite(n) && n >= 1.01 ? n : undefined;
}

function parseMatchHint(text: string): string | undefined {
  const m = RE_MATCH_HINT.exec(text);
  if (!m) return undefined;
  return `${m[1].trim()} × ${m[2].trim()}`;
}

function parseReminderMinutesBefore(text: string): number | undefined {
  const m = RE_REMINDER_BEFORE.exec(text);
  if (!m) return undefined;
  const n = Number.parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const isHours = m[2].toLowerCase().startsWith("h");
  return isHours ? n * 60 : n;
}

function lower(s: string): string {
  return s.toLowerCase();
}

/**
 * Classifica a mensagem do usuário em uma intent. A ordem dos
 * checks importa — intents mais específicas primeiro.
 */
export function parseIntent(rawText: string): ParsedIntent {
  const raw = rawText.trim();
  const t = lower(raw);

  const amount = parseAmount(raw);
  const oddTarget = parseOdd(raw);
  const matchHint = parseMatchHint(raw);
  const reminderMinutesBefore = parseReminderMinutesBefore(raw);

  // 1) Lembrete — "lembre", "me avisa", "alerta antes"
  if (
    /lembre|lembre[mt]e|me avis|me avisa|me lembra|alerta antes|notific/.test(t)
  ) {
    return {
      type: "save_reminder",
      raw,
      reminderMinutesBefore,
      matchHint,
    };
  }

  // 2a) UPDATE de aposta existente — verbo de correção + dado novo.
  //     Tem prioridade sobre save_bet quando ambos casariam.
  //     Ex.: "corrige a aposta para stake 188 e odd 1.95"
  //          "a entrada foi de 188 reais e retorno 367"
  const hasCorrectionVerb =
    /\b(corrig[eai]|corre[cç][aã]o|atualiz[aoe]|ajust[aoe]|errad[oa]|correto|certa?)\b/.test(
      t
    );
  const mentionsBet = /\baposta\b/.test(t);
  const looksLikeUpdate =
    (hasCorrectionVerb && (mentionsBet || /\b(stake|odd|retorno|entrada)\b/.test(t))) ||
    // formas curtas sem verbo: "stake correto é X" / "odd certa é X"
    /\b(stake|odd|retorno|entrada)\b\s+(?:correto|certo|certa)\b/.test(t);

  // Não cair em update se o texto também tem bullet legs (claramente uma criação).
  const hasBulletLegEarly = /^\s*[\-•*]\s+\S/m.test(raw);

  if (looksLikeUpdate && !hasBulletLegEarly) {
    return { type: "update_bet", raw, amount, oddTarget, matchHint };
  }

  // 2b) Salvar/registrar aposta nova — duas formas:
  //    (a) verbo explícito "salva"/"registra"/"grava" + algum sinal
  //    (b) texto colado da casa: stake + odd + linhas começando com "-"
  //        (sem verbo, mas claramente um print de aposta)
  const hasSaveVerb =
    /\b(salva|salvar|registra|registrar|grava|gravar)\b.*\b(aposta|com|R\$|reais)/.test(t) ||
    /\b(salva|salvar|registra|registrar)\b.*\bcom\s*\d/.test(t) ||
    (/\bregistra\b|\bsalva\b/.test(t) && amount !== undefined);

  // Heurística "texto colado": tem rótulo de stake + odd + ≥ 1 linha com "- "
  const hasStakeLabel = /\b(stake|valor)\b\s*[:\-]/i.test(raw);
  const hasOddLabel = /\bodd\b\s*(?:total|combinada)?\s*[:\-]?\s*\d/i.test(raw);
  const looksLikeBetPrint = hasStakeLabel && hasOddLabel && hasBulletLegEarly;

  if (hasSaveVerb || looksLikeBetPrint) {
    return {
      type: "save_bet",
      raw,
      amount,
      oddTarget,
      matchHint,
    };
  }

  // 3) Construir combinação — "monta odd N", "combina pra dar N", "fecha odd N"
  if (
    /\b(monta|montar|fecha|fechar|combina|combinar)\b.*\bodd\b/.test(t) ||
    /\bcombo\s*(de|com)?\s*odd\b/.test(t) ||
    (/\bmonta\b/.test(t) && oddTarget !== undefined)
  ) {
    return { type: "build_combo", raw, oddTarget, matchHint };
  }

  // 4) Quanto posso apostar — limite/banca/quanto
  if (
    /\b(quanto)\b.*\b(apost|posso|hoje|sobra|resta)\b/.test(t) ||
    /\b(meu )?(limite|banca|saldo)\b.*\b(hoje|atual|disponí|disponi)\b/.test(t) ||
    /\bquanto\s+(eu\s+)?(posso\s+)?apostar/.test(t)
  ) {
    return { type: "bankroll_info", raw };
  }

  // 5) Conselho de risco — "vou colocar mais um jogo", "adicionar mais"
  if (
    /\b(adicionar|colocar|incluir)\b.*\b(mais|outro)\s+(jogo|perna)/.test(t) ||
    /múltipla\s+longa|multipla\s+longa/.test(t) ||
    /\b(estou pensando|to pensando|tô pensando)\b.*\b(colocar|adicionar)/.test(t)
  ) {
    return { type: "risk_advice", raw };
  }

  // 6) Explicar pick — "explica", "racional", "por que essa pick"
  if (
    /\b(explica|explicar|explique|racional|por que|porque)\b/.test(t) &&
    /\b(pick|aposta|jogo|entrada|análise|analise)\b/.test(t)
  ) {
    return { type: "explain_pick", raw, matchHint };
  }
  // versão mais permissiva: começa com "explica"
  if (/^explica\b/.test(t)) {
    return { type: "explain_pick", raw, matchHint };
  }

  return { type: "fallback", raw };
}
