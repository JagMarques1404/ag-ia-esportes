import { type NextRequest } from "next/server";
import { syncTodayFixtures } from "@/lib/api-football/sync";
import { getQuotaSummary } from "@/lib/api-football/quota";
import { buildDailyValueBoard } from "@/lib/features/value-board";
import { validateInternalApiAccess } from "@/lib/security/api-access";
import { okResponse, errorResponse } from "@/lib/api/response";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayString(): string {
  return new Date().toISOString().split("T")[0];
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ type: string }> }
) {
  const access = await validateInternalApiAccess(request);
  if (!access.ok) {
    return errorResponse(access.reason, {}, 401);
  }

  const { type } = await params;

  try {
    switch (type) {
      case "today-fixtures": {
        const result = await syncTodayFixtures();
        const quota = await getQuotaSummary();
        return okResponse(result, { quota });
      }

      case "today-features": {
        const result = await buildDailyValueBoard(todayString());
        const quota = await getQuotaSummary();
        return okResponse(result, { quota });
      }

      case "date-features": {
        const date = request.nextUrl.searchParams.get("date");
        if (!date || !DATE_RE.test(date)) {
          return errorResponse(
            "date-features requer ?date=YYYY-MM-DD",
            { date },
            400
          );
        }
        const result = await buildDailyValueBoard(date);
        const quota = await getQuotaSummary();
        return okResponse(result, { quota, date });
      }

      // Novos sync_types entram aqui.
      default:
        return errorResponse(`sync_type não suportado: ${type}`, { type }, 400);
    }
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : "Erro desconhecido",
      { type },
      500
    );
  }
}
