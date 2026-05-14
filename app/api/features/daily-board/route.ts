import { type NextRequest } from "next/server";
import {
  buildDailyValueBoard,
  getDailyValueBoard,
} from "@/lib/features/value-board";
import { okResponse, errorResponse } from "@/lib/api/response";
import { validateInternalApiAccess } from "@/lib/security/api-access";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const access = await validateInternalApiAccess(request);
  if (!access.ok) {
    return errorResponse(access.reason, {}, 401);
  }

  const dateParam = request.nextUrl.searchParams.get("date");
  const date = dateParam ?? new Date().toISOString().split("T")[0];
  if (!DATE_RE.test(date)) {
    return errorResponse(
      "Parâmetro 'date' inválido. Use YYYY-MM-DD.",
      { date },
      400
    );
  }
  const refresh = request.nextUrl.searchParams.get("refresh") !== "false";

  try {
    let summary = null;
    if (refresh) {
      summary = await buildDailyValueBoard(date);
    }
    const board = await getDailyValueBoard(date);
    return okResponse({ board, summary }, { date, refresh });
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : "Erro desconhecido",
      { date },
      500
    );
  }
}
