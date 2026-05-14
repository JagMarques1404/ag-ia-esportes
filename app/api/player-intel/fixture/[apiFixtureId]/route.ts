import { type NextRequest } from "next/server";
import { runFixturePlayerIntel } from "@/lib/player-intel";
import { okResponse, errorResponse } from "@/lib/api/response";
import { validateInternalApiAccess } from "@/lib/security/api-access";

export const dynamic = "force-dynamic";

export async function GET(
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
    const result = await runFixturePlayerIntel(id);

    // Top 20 por probability * confidence_score (sinal técnico v0.1).
    const top = [...result.probabilities]
      .sort(
        (a, b) =>
          b.probability * b.confidence_score -
          a.probability * a.confidence_score
      )
      .slice(0, 20);

    return okResponse({
      summary: {
        fixture_id: result.fixture_id,
        api_fixture_id: result.api_fixture_id,
        players_analyzed: result.players_analyzed,
        matchups_built: result.matchups_built,
        probabilities_generated: result.probabilities_generated,
        data_quality_avg: result.data_quality_avg,
        warnings: result.warnings,
      },
      matchups: result.matchups,
      top_actions: top,
    });
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : "Erro desconhecido",
      { api_fixture_id: id },
      500
    );
  }
}
