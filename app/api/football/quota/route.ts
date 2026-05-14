import { getQuotaSummary } from "@/lib/api-football/quota";
import { okResponse, errorResponse } from "@/lib/api/response";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const summary = await getQuotaSummary();
    return okResponse(summary);
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : "Erro desconhecido",
      {},
      500
    );
  }
}
