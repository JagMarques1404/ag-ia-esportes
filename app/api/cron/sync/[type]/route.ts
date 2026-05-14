import { type NextRequest } from "next/server";
import { syncTodayFixtures } from "@/lib/api-football/sync";
import { getQuotaSummary } from "@/lib/api-football/quota";
import { validateCronSecret } from "@/lib/security/cron";
import { okResponse, errorResponse } from "@/lib/api/response";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ type: string }> }
) {
  const auth = validateCronSecret(request);
  if (!auth.ok) {
    return errorResponse(auth.reason ?? "Não autorizado", {}, 401);
  }

  const { type } = await params;

  try {
    switch (type) {
      case "today-fixtures": {
        const result = await syncTodayFixtures();
        const quota = await getQuotaSummary();
        return okResponse(result, { quota });
      }
      // Novos sync_types entram aqui (ex.: 'lineups-today', 'stats-yesterday').
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
