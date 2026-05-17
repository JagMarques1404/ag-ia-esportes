import "@/lib/server-only-guard";
import { type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/security/api-access";
import { okResponse, errorResponse } from "@/lib/api/response";
import { generateBestUpcomingMulti } from "@/lib/player-intel/day-multi-generator";

/**
 * POST /api/studio/generate-upcoming-multi
 *
 * Body:
 *   {
 *     "date": "2026-05-17",
 *     "fromTime": "now" | "HH:mm",   (default: "now")
 *     "mode": "safe" | "value" | "all" (default: "all")
 *   }
 *
 * Retorna best_solo + safe_multi + value_multi + jogos ignorados.
 */
export const dynamic = "force-dynamic";

interface ReqBody {
  date?: string;
  fromTime?: string;
  mode?: "safe" | "value" | "all";
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return errorResponse("Não autorizado", {}, 401);
  }

  let body: ReqBody = {};
  try {
    body = (await request.json()) as ReqBody;
  } catch {
    // body opcional → defaults
  }

  const date = body.date ?? (() => {
    const now = new Date(Date.now() - 3 * 60 * 60_000);
    return now.toISOString().split("T")[0];
  })();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return errorResponse("date inválido (YYYY-MM-DD esperado)", {}, 400);
  }

  const fromTime =
    body.fromTime && body.fromTime !== "now" ? body.fromTime : undefined;
  try {
    const summary = await generateBestUpcomingMulti({
      date,
      fromNow: !fromTime,
      fromTime,
    });
    // mode='safe'/'value' filtra a saída
    if (body.mode === "safe") {
      summary.value_multi = null;
    } else if (body.mode === "value") {
      summary.safe_multi = null;
    }
    return okResponse(summary, { date, fromTime: fromTime ?? "now" });
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : "Erro desconhecido",
      {},
      500
    );
  }
}
