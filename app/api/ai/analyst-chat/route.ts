import { type NextRequest } from "next/server";
import { ensureSession, runAnalyst } from "@/lib/ai/analyst-engine";
import { getCurrentUser } from "@/lib/security/api-access";
import { okResponse, errorResponse } from "@/lib/api/response";

export const dynamic = "force-dynamic";

interface ChatBody {
  sessionId?: string | null;
  message?: string;
}

export async function POST(request: NextRequest) {
  // Auth: exige sessão Supabase. Não aceita CRON_SECRET aqui — é
  // chamada do app, não de job.
  const user = await getCurrentUser();
  if (!user) {
    return errorResponse("Não autorizado: sessão obrigatória.", {}, 401);
  }

  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return errorResponse("Corpo inválido (JSON esperado).", {}, 400);
  }
  const message = (body.message ?? "").trim();
  if (!message) {
    return errorResponse("Campo 'message' obrigatório.", {}, 400);
  }
  if (message.length > 1500) {
    return errorResponse("Mensagem muito longa (máx 1500 caracteres).", {}, 400);
  }

  try {
    const session = await ensureSession(user.id, body.sessionId ?? null);
    const result = await runAnalyst({
      userId: user.id,
      sessionId: session.id,
      userMessage: message,
    });

    return okResponse({
      session_id: session.id,
      created_session: session.created,
      assistant_text: result.text,
      pending_action: result.pending_action ?? null,
      intent: result.intent.type,
    });
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : "Erro desconhecido",
      {},
      500
    );
  }
}
