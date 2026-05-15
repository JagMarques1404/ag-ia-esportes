import "@/lib/server-only-guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { parseIntent, type ParsedIntent } from "./intent";
import {
  createBetDraft,
  createReminderDraft,
  getOpenBets,
  getRecentBetHistory,
  getTodayPicks,
  getUserBankroll,
  type DailyPick,
  type DraftBetPayload,
  type PendingActionRow,
} from "./analyst-tools";

export interface AnalystResponse {
  /** Texto que aparece como mensagem do assistente. */
  text: string;
  /** Se a intenção criou uma ação pendente que precisa de confirmação. */
  pending_action?: PendingActionRow;
  /** Intent detectada — útil pra UI/telemetria. */
  intent: ParsedIntent;
}

const RESPONSIBILITY_FOOTER =
  "\n\n_Lembrete: análise estatística, não recomendação financeira. Não há garantia de lucro. Aposte com responsabilidade._";

function fmtBRL(n: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(n);
}

function findBestPickForHint(
  picks: DailyPick[],
  hint: string | undefined
): DailyPick | null {
  if (!picks.length) return null;
  if (!hint) return picks[0];
  const lh = hint.toLowerCase();
  for (const p of picks) {
    if (lh.includes(p.match.toLowerCase().split(" × ")[0]) ||
        lh.includes(p.match.toLowerCase().split(" × ")[1] ?? "")) {
      return p;
    }
  }
  return picks[0];
}

// ============================================================
// Logging helpers
// ============================================================

async function logMessage(args: {
  sessionId: string;
  userId: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const supabase = getSupabaseAdmin();
  await supabase.from("ai_chat_messages").insert({
    session_id: args.sessionId,
    user_id: args.userId,
    role: args.role,
    content: args.content,
    metadata: args.metadata ?? {},
  });
}

export async function ensureSession(
  userId: string,
  sessionId: string | null
): Promise<{ id: string; created: boolean }> {
  const supabase = getSupabaseAdmin();
  if (sessionId) {
    const { data } = await supabase
      .from("ai_chat_sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (data) return { id: data.id as string, created: false };
  }
  const { data, error } = await supabase
    .from("ai_chat_sessions")
    .insert({ user_id: userId, title: "Conversa com Analista" })
    .select("id")
    .single();
  if (error) throw new Error(`ensureSession: ${error.message}`);
  return { id: data.id as string, created: true };
}

// ============================================================
// Handlers por intent
// ============================================================

async function handleExplainPick(
  userId: string,
  intent: ParsedIntent
): Promise<string> {
  const picks = getTodayPicks(userId);
  const pick = findBestPickForHint(picks, intent.matchHint ?? intent.raw);
  if (!pick) {
    return "Não encontrei picks publicadas para hoje. Tente novamente quando o board do dia estiver gerado.";
  }
  const lines: string[] = [];
  lines.push(`**${pick.match}** · ${pick.league}`);
  lines.push(`Tier: **${pick.risk}**  ·  Odd alvo: **${pick.odd_target.toFixed(2)}**  ·  Status: ${pick.status}`);
  lines.push("");
  lines.push("**Mercados sugeridos:**");
  for (const m of pick.markets) {
    lines.push(`- ${m.player} — ${m.market}`);
  }
  lines.push("");
  lines.push(`**Racional:** ${pick.rationale}`);

  // Risk hints
  if (pick.risk === "Mega") {
    lines.push("");
    lines.push("⚠ **Pior perna** (maior risco de quebrar): combinação tem múltiplas pernas independentes; cada uma pode ser plausível, mas a multiplicação derruba muito a probabilidade total. Use stake reduzida.");
  } else if (pick.risk === "Valor") {
    lines.push("");
    lines.push("ℹ **Melhor perna**: a primeira costuma ter maior probabilidade individual. Considere também versões parciais (sem a perna mais arriscada).");
  } else {
    lines.push("");
    lines.push("✓ **Melhor perna**: as 3 são consistentes. A entrada Segura assume que todas saem juntas; se uma falhar, perde tudo.");
  }
  return lines.join("\n") + RESPONSIBILITY_FOOTER;
}

function handleBuildCombo(
  userId: string,
  intent: ParsedIntent
): string {
  const picks = getTodayPicks(userId);
  const pick = findBestPickForHint(picks, intent.matchHint);
  const target = intent.oddTarget ?? 3.0;

  if (!pick) {
    return `Não encontrei picks para combinar. Tente quando o board do dia estiver pronto.${RESPONSIBILITY_FOOTER}`;
  }

  const lines: string[] = [];
  lines.push(`Sugestão de combinação visando odd **${target.toFixed(2)}** em **${pick.match}**:`);
  lines.push("");
  // Mock: usar 2 mercados do pick Segura + 1 do Mega para chegar perto do alvo
  const segura = picks.find((p) => p.risk === "Segura") ?? pick;
  const valor = picks.find((p) => p.risk === "Valor");
  const combo = [
    segura.markets[0],
    segura.markets[1],
    valor?.markets[0] ?? segura.markets[2],
  ].filter(Boolean) as { player: string; market: string }[];

  for (const m of combo) {
    lines.push(`- ${m.player} — ${m.market}`);
  }
  lines.push("");
  lines.push(`Odd combinada estimada para essa configuração: aproximadamente **${target.toFixed(2)}**.`);
  lines.push("Essa estimativa é uma sugestão de montagem — confira os preços reais na sua casa de aposta antes de fechar.");
  lines.push("");
  lines.push("Se quiser registrar, diga: **\"salva essa aposta com R$ X\"**.");
  return lines.join("\n") + RESPONSIBILITY_FOOTER;
}

async function handleSaveBet(
  userId: string,
  sessionId: string,
  intent: ParsedIntent
): Promise<{ text: string; pending_action: PendingActionRow }> {
  const picks = getTodayPicks(userId);
  const pick = findBestPickForHint(picks, intent.matchHint);
  const stake = intent.amount;

  if (!stake) {
    throw new Error(
      "Para salvar uma aposta preciso do valor. Ex.: \"salva essa aposta com R$ 50\"."
    );
  }
  if (!pick) {
    throw new Error("Não tenho pick contextual para salvar. Diga qual jogo.");
  }

  // Validação contra banca
  const bankroll = await getUserBankroll(userId);
  const warnings: string[] = [];
  if (bankroll) {
    if (stake > bankroll.current_balance) {
      throw new Error(
        `Stake R$ ${stake.toFixed(2)} maior que o saldo atual (${fmtBRL(bankroll.current_balance)}).`
      );
    }
    const maxByPct =
      bankroll.current_balance * (bankroll.max_stake_pct / 100);
    if (stake > maxByPct) {
      warnings.push(
        `⚠ Stake acima do limite de ${bankroll.max_stake_pct}% por aposta (${fmtBRL(maxByPct)}). Considere reduzir.`
      );
    }
    if (stake > bankroll.remaining_today) {
      warnings.push(
        `⚠ Stake estoura o limite diário restante (${fmtBRL(bankroll.remaining_today)}).`
      );
    }
  }

  // Tier alinhado ao schema (segura/intermediaria/avancada/mega_sena)
  const tierMap: Record<DailyPick["risk"], DraftBetPayload["tier"]> = {
    Segura: "segura",
    Valor: "avancada",
    Mega: "mega_sena",
  };
  const odd = pick.odd_target;
  const draft: DraftBetPayload = {
    match_name: pick.match,
    total_stake: stake,
    combined_odd: odd,
    tier: tierMap[pick.risk],
    legs: pick.markets.map((m) => ({
      competition: pick.league,
      home_team: pick.match.split(" × ")[0] ?? "?",
      away_team: pick.match.split(" × ")[1] ?? "?",
      market_type: m.market,
      selection: m.player,
      // Sem odd individual confiável; distribui geometricamente.
      odd_value: Number(Math.pow(odd, 1 / pick.markets.length).toFixed(2)),
    })),
  };
  const action = await createBetDraft(userId, sessionId, draft);

  const lines: string[] = [];
  lines.push(`Vou registrar essa aposta? **${pick.match}** (${pick.risk})`);
  lines.push("");
  lines.push(`- Stake: ${fmtBRL(stake)}`);
  lines.push(`- Odd combinada: ${odd.toFixed(2)}`);
  lines.push(`- Retorno potencial: ${fmtBRL(stake * odd)}`);
  lines.push(`- Lucro líquido se ganhar: ${fmtBRL(stake * odd - stake)}`);
  if (warnings.length) {
    lines.push("");
    lines.push(...warnings);
  }
  lines.push("");
  lines.push("Use os botões abaixo para **confirmar** ou **cancelar**.");
  return {
    text: lines.join("\n") + RESPONSIBILITY_FOOTER,
    pending_action: action,
  };
}

async function handleSaveReminder(
  userId: string,
  sessionId: string,
  intent: ParsedIntent
): Promise<{ text: string; pending_action: PendingActionRow }> {
  const picks = getTodayPicks(userId);
  const pick = findBestPickForHint(picks, intent.matchHint);
  const minutesBefore = intent.reminderMinutesBefore ?? 30;

  if (!pick) {
    throw new Error(
      "Não consegui amarrar o lembrete a um jogo específico. Diga qual."
    );
  }

  // Sem kickoff_at confiável nos picks mockados; usa 'em N horas' como placeholder.
  const now = new Date();
  const kickoff = new Date(now.getTime() + 6 * 60 * 60 * 1000); // +6h
  const reminder = new Date(kickoff.getTime() - minutesBefore * 60 * 1000);

  const action = await createReminderDraft(userId, sessionId, {
    type: "bet_reminder",
    match_name: pick.match,
    kickoff_at: kickoff.toISOString(),
    reminder_at: reminder.toISOString(),
    message: `Revisar aposta antes de ${pick.match}`,
  });

  const lines: string[] = [];
  lines.push(`Quero criar um lembrete para **${pick.match}**:`);
  lines.push(`- ${minutesBefore} minutos antes do kickoff`);
  lines.push(`- Mensagem: "Revisar aposta antes de ${pick.match}"`);
  lines.push("");
  lines.push(
    "ℹ A entrega de notificações ainda não está ligada — o lembrete fica gravado para quando o job for ativado."
  );
  lines.push("Confirma?");
  return {
    text: lines.join("\n") + RESPONSIBILITY_FOOTER,
    pending_action: action,
  };
}

async function handleBankrollInfo(userId: string): Promise<string> {
  const br = await getUserBankroll(userId);
  if (!br) {
    return "Ainda não encontrei sua banca configurada. Vá em **/settings** para definir saldo inicial e limites.";
  }
  const lines: string[] = [];
  lines.push(`**Saldo atual:** ${fmtBRL(br.current_balance)}`);
  lines.push(`**Stake máx por aposta:** ${br.max_stake_pct}% (${fmtBRL(br.current_balance * br.max_stake_pct / 100)})`);
  lines.push(`**Limite diário total:** ${br.daily_limit_pct}% (${fmtBRL(br.current_balance * br.daily_limit_pct / 100)})`);
  lines.push(`**Apostado hoje:** ${fmtBRL(br.staked_today)}  ·  **Restante hoje:** ${fmtBRL(br.remaining_today)}`);
  lines.push(`**P&L do dia:** ${fmtBRL(br.pnl_today)}`);
  if (br.blocked_until) {
    lines.push(`⚠ Apostas bloqueadas até ${br.blocked_until}.`);
  }
  return lines.join("\n") + RESPONSIBILITY_FOOTER;
}

async function handleRiskAdvice(userId: string): Promise<string> {
  const open = await getOpenBets(userId);
  const recent = await getRecentBetHistory(userId, 10);
  const losses = recent.filter((b) => b.status === "lost").length;
  const lines: string[] = [];
  lines.push("Adicionar mais uma perna **derruba a probabilidade combinada multiplicativamente.**");
  lines.push("");
  lines.push("Sugestão prática:");
  lines.push("- Em vez de aumentar a múltipla, considere **dividir o capital em Principal + Valor**.");
  lines.push("- Se a entrada já é Mega (alta variância), reduzir stake em vez de adicionar pernas costuma melhorar o resultado a longo prazo.");
  lines.push("- Cada perna extra deve ter **edge claro** — não combine só pra subir a odd.");
  if (open.length > 0) {
    lines.push("");
    lines.push(`Você tem **${open.length} aposta(s) aberta(s)** com stake total ${fmtBRL(
      open.reduce((a, b) => a + Number(b.total_stake ?? 0), 0)
    )}. Avalie se já não está exposto demais.`);
  }
  if (losses >= 3) {
    lines.push("");
    lines.push("⚠ Você teve **3+ perdas recentes**. Não use a próxima aposta para 'recuperar'. Considere dar uma pausa.");
  }
  return lines.join("\n") + RESPONSIBILITY_FOOTER;
}

function handleFallback(): string {
  return [
    "Posso ajudar com:",
    "- **Explicar pick** — \"explica a pick do Vitória × Flamengo\"",
    "- **Montar combinação** — \"monta uma odd 3.00 com esse jogo\"",
    "- **Salvar aposta** (com confirmação) — \"salva essa aposta com R$ 50\"",
    "- **Criar lembrete** (com confirmação) — \"me lembra 10 minutos antes do jogo\"",
    "- **Consultar banca** — \"quanto posso apostar hoje?\"",
    "- **Conselho de risco** — \"estou pensando em colocar mais um jogo\"",
  ].join("\n") + RESPONSIBILITY_FOOTER;
}

// ============================================================
// Entrypoint
// ============================================================

export async function runAnalyst(args: {
  userId: string;
  sessionId: string;
  userMessage: string;
}): Promise<AnalystResponse> {
  const { userId, sessionId, userMessage } = args;

  await logMessage({ sessionId, userId, role: "user", content: userMessage });

  const intent = parseIntent(userMessage);
  let text = "";
  let pending_action: PendingActionRow | undefined;

  try {
    switch (intent.type) {
      case "explain_pick":
        text = await handleExplainPick(userId, intent);
        break;
      case "build_combo":
        text = handleBuildCombo(userId, intent);
        break;
      case "save_bet": {
        const r = await handleSaveBet(userId, sessionId, intent);
        text = r.text;
        pending_action = r.pending_action;
        break;
      }
      case "save_reminder": {
        const r = await handleSaveReminder(userId, sessionId, intent);
        text = r.text;
        pending_action = r.pending_action;
        break;
      }
      case "bankroll_info":
        text = await handleBankrollInfo(userId);
        break;
      case "risk_advice":
        text = await handleRiskAdvice(userId);
        break;
      default:
        text = handleFallback();
    }
  } catch (err) {
    text =
      (err instanceof Error ? err.message : "Erro inesperado.") +
      RESPONSIBILITY_FOOTER;
  }

  await logMessage({
    sessionId,
    userId,
    role: "assistant",
    content: text,
    metadata: {
      intent: intent.type,
      pending_action_id: pending_action?.id ?? null,
    },
  });

  return { text, pending_action, intent };
}
