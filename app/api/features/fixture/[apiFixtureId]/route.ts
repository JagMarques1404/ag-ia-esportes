import { type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  calculateFixtureFeatures,
  upsertFixtureFeatures,
} from "@/lib/features/fixture-features";
import {
  calculateAllMarketProbabilities,
  upsertMarketProbabilities,
} from "@/lib/features/probability-engine";
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
    const supabase = getSupabaseAdmin();
    const { data: fx, error } = await supabase
      .from("football_fixtures")
      .select("id")
      .eq("api_fixture_id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!fx) {
      return errorResponse(
        `Fixture local não encontrada para api_fixture_id=${id}. Rode /api/football/fixtures/today antes.`,
        { api_fixture_id: id },
        404
      );
    }

    const features = await calculateFixtureFeatures(fx.id);
    await upsertFixtureFeatures(features);

    const probabilities = calculateAllMarketProbabilities(features);
    await upsertMarketProbabilities(probabilities);

    return okResponse({
      features,
      probabilities,
    });
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : "Erro desconhecido",
      { api_fixture_id: id },
      500
    );
  }
}
