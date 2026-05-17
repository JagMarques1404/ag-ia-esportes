import "@/lib/server-only-guard";
import { type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/security/api-access";
import { okResponse, errorResponse } from "@/lib/api/response";
import { saveAndProcessExternalLineup } from "@/lib/player-intel/lineup-scout";

/**
 * POST /api/studio/external-lineup
 *
 * Body:
 *   {
 *     "apiFixtureId": 1492260,
 *     "sourceName": "FutStats",
 *     "sourceUrl": "https://...",
 *     "sourceType": "predicted" | "confirmed",
 *     "text": "Athletico-PR (4-2-3-1): Bento; Madson, Belezi, Pedro Henrique, ...\nFlamengo (4-3-3): Rossi; Wesley, ...",
 *     "generateBoard": true,        // default true
 *     "resolveApi": false           // default false
 *   }
 *
 * Retorna:
 *   - save: contadores de resolução (matched, sintético, unresolved, etc.)
 *   - board: snapshot do fixture-processor (readiness, picks, etc.)
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ReqBody {
  apiFixtureId?: number;
  sourceName?: string;
  sourceUrl?: string | null;
  sourceType?: "predicted" | "confirmed";
  text?: string;
  generateBoard?: boolean;
  resolveApi?: boolean;
  apiLimit?: number;
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return errorResponse("Não autorizado", {}, 401);

  let body: ReqBody;
  try {
    body = (await request.json()) as ReqBody;
  } catch {
    return errorResponse("JSON inválido", {}, 400);
  }

  if (!body.apiFixtureId || !Number.isFinite(body.apiFixtureId)) {
    return errorResponse("apiFixtureId obrigatório", {}, 400);
  }
  if (!body.sourceName || body.sourceName.trim().length < 2) {
    return errorResponse("sourceName obrigatório", {}, 400);
  }
  if (!body.text || body.text.trim().length < 10) {
    return errorResponse(
      "text obrigatório (cole a escalação com formato 'TimeA: J1, J2, ...; TimeB: ...')",
      {},
      400
    );
  }
  if (body.sourceType !== "predicted" && body.sourceType !== "confirmed") {
    return errorResponse(
      "sourceType deve ser 'predicted' ou 'confirmed'",
      {},
      400
    );
  }

  try {
    const result = await saveAndProcessExternalLineup({
      input: {
        apiFixtureId: body.apiFixtureId,
        sourceName: body.sourceName.trim(),
        sourceUrl: body.sourceUrl ?? null,
        sourceType: body.sourceType,
        text: body.text,
        resolveApi: body.resolveApi === true,
        apiLimit: body.apiLimit ?? 10,
      },
      generateBoard: body.generateBoard !== false,
    });
    return okResponse(result, {
      apiFixtureId: body.apiFixtureId,
      sourceType: body.sourceType,
    });
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : "Erro",
      {},
      500
    );
  }
}
