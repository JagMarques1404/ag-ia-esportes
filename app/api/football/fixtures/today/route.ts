import {
  syncTodayFixtures,
  getSavedFixturesByDate,
} from "@/lib/api-football/sync";
import { getQuotaSummary } from "@/lib/api-football/quota";
import { okResponse, errorResponse } from "@/lib/api/response";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await syncTodayFixtures();
    const fixtures = await getSavedFixturesByDate(result.date);
    const quota = await getQuotaSummary();
    return okResponse(
      { fixtures, sync: result },
      { quota }
    );
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : "Erro desconhecido",
      {},
      500
    );
  }
}
