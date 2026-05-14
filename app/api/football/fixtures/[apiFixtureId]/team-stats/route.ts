import { type NextRequest } from "next/server";
import { syncFixtureTeamStats } from "@/lib/api-football/sync";
import { getQuotaSummary } from "@/lib/api-football/quota";
import { okResponse, errorResponse } from "@/lib/api/response";

export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ apiFixtureId: string }> }
) {
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
