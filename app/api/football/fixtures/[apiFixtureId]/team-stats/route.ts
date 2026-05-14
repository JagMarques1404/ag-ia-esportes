import { type NextRequest } from "next/server";
import { syncFixtureTeamStats } from "@/lib/api-football/sync";
import { getQuotaSummary } from "@/lib/api-football/quota";
import { okResponse, errorResponse } from "@/lib/api/response";
import { validateInternalApiAccess } from "@/lib/security/api-access";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ apiFixtureId: string }> }
) {
  const access = await validateInternalApiAccess(request);
  if (!access.ok) {
    return errorResponse(access.reason, {}, 401);
  }

  const { apiFixtureId } = await params;
  const id = Number(apiFixtureId);
  if (!Number.isFinite(id) || id <= 0) {
    return errorResponse("apiFixtureId inválido.", { apiFixtureId }, 400);
  }
  try {
    const result = await syncFixtureTeamStats(id);
    const quota = await getQuotaSummary();
    return okResponse(result, { quota });
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : "Erro desconhecido",
      {},
      500
    );
  }
}
