import { type NextRequest } from "next/server";
import {
  syncFixturesByDate,
  getSavedFixturesByDate,
} from "@/lib/api-football/sync";
import { getQuotaSummary } from "@/lib/api-football/quota";
import { okResponse, errorResponse } from "@/lib/api/response";
import { validateInternalApiAccess } from "@/lib/security/api-access";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const access = await validateInternalApiAccess(request);
  if (!access.ok) {
    return errorResponse(access.reason, {}, 401);
  }

  const date = request.nextUrl.searchParams.get("date");
  if (!date || !DATE_RE.test(date)) {
    return errorResponse(
      "Parâmetro 'date' inválido. Use YYYY-MM-DD.",
      { date },
      400
    );
  }
  try {
    const result = await syncFixturesByDate(date);
    const fixtures = await getSavedFixturesByDate(date);
    const quota = await getQuotaSummary();
    return okResponse({ fixtures, sync: result }, { quota });
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : "Erro desconhecido",
      {},
      500
    );
  }
}
