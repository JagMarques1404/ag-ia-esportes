import { type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/security/api-access";
import { okResponse, errorResponse } from "@/lib/api/response";
import {
  settleLegAndMaybeBet,
  type LegResult,
} from "@/lib/bets/settlement";

export const dynamic = "force-dynamic";

interface SettleBody {
  legId?: string;
  result?: string;
  actual_value?: string | null;
  notes?: string | null;
}

const ALLOWED_RESULTS: ReadonlyArray<LegResult> = [
  "won",
  "lost",
  "void",
  "pending",
];

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return errorResponse("Não autorizado: sessão obrigatória.", {}, 401);
  }

  const { id: betId } = await context.params;
  if (!betId || typeof betId !== "string") {
    return errorResponse("Bet id inválido.", {}, 400);
  }

  let body: SettleBody;
  try {
    body = (await request.json()) as SettleBody;
  } catch {
    return errorResponse("Corpo inválido (JSON esperado).", {}, 400);
  }

  const legId = body.legId;
  const result = body.result;
  if (!legId || typeof legId !== "string") {
    return errorResponse("legId é obrigatório.", {}, 400);
  }
  if (!result || !ALLOWED_RESULTS.includes(result as LegResult)) {
    return errorResponse(
      `result inválido (esperado: ${ALLOWED_RESULTS.join("|")}).`,
      { received: result },
      400
    );
  }

  try {
    const out = await settleLegAndMaybeBet({
      userId: user.id,
      betId,
      legId,
      result: result as LegResult,
      actualValue: body.actual_value ?? null,
      notes: body.notes ?? null,
    });
    return okResponse(out, { bet_id: betId, leg_id: legId });
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : "Erro desconhecido",
      { bet_id: betId, leg_id: legId },
      500
    );
  }
}
