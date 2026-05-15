import { type NextRequest } from "next/server";
import {
  cancelPendingAction,
  confirmPendingAction,
} from "@/lib/ai/analyst-tools";
import { getCurrentUser } from "@/lib/security/api-access";
import { okResponse, errorResponse } from "@/lib/api/response";

export const dynamic = "force-dynamic";

interface ConfirmBody {
  action_id?: string;
  decision?: "confirm" | "cancel";
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return errorResponse("Não autorizado: sessão obrigatória.", {}, 401);
  }

  let body: ConfirmBody;
  try {
    body = (await request.json()) as ConfirmBody;
  } catch {
    return errorResponse("Corpo inválido (JSON esperado).", {}, 400);
  }
  const actionId = body.action_id;
  const decision = body.decision;
  if (!actionId || (decision !== "confirm" && decision !== "cancel")) {
    return errorResponse(
      "Campos obrigatórios: action_id, decision ('confirm' | 'cancel').",
      {},
      400
    );
  }

  try {
    const result =
      decision === "confirm"
        ? await confirmPendingAction(user.id, actionId)
        : await cancelPendingAction(user.id, actionId);
    return okResponse(result, { action_id: actionId, decision });
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : "Erro desconhecido",
      { action_id: actionId },
      500
    );
  }
}
