import { type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/security/api-access";
import { okResponse, errorResponse } from "@/lib/api/response";

export const dynamic = "force-dynamic";

type LegStatus = "pending" | "green" | "red" | "void";

interface IncomingLeg {
  position: number;
  player_name: string;
  market: string;
  line: number | null;
  odd: number | null;
  actual_value: string | null;
  result_status: LegStatus;
  result_notes: string | null;
}

interface ReqBody {
  legs?: IncomingLeg[];
}

const STATUS_VALUES: LegStatus[] = ["pending", "green", "red", "void"];

function recomputePickStatus(legs: IncomingLeg[]): {
  status: "draft" | "published" | "green" | "red" | "void";
  notes: string;
} {
  const total = legs.length;
  if (total === 0) {
    return { status: "draft", notes: "Sem pernas registradas." };
  }
  const greens = legs.filter((l) => l.result_status === "green");
  const reds = legs.filter((l) => l.result_status === "red");
  const voids = legs.filter((l) => l.result_status === "void");
  const pendings = legs.filter((l) => l.result_status === "pending");

  if (pendings.length > 0) {
    return {
      status: "published",
      notes: `${greens.length}/${total} bateram até agora · ${pendings.length} perna(s) pendente(s).`,
    };
  }
  if (reds.length > 0) {
    const broken = reds
      .map((l) => `${l.player_name} ${l.market}`)
      .join(", ");
    return {
      status: "red",
      notes: `${greens.length}/${total} pernas bateram. Pernas red: ${broken}.`,
    };
  }
  if (voids.length === total) {
    return { status: "void", notes: `Todas as ${total} pernas anuladas.` };
  }
  // só greens (e talvez voids)
  if (voids.length > 0) {
    return {
      status: "green",
      notes: `${greens.length}/${total} pernas verdes, ${voids.length} void.`,
    };
  }
  return { status: "green", notes: `${greens.length}/${total} pernas bateram.` };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return errorResponse("Não autorizado: sessão obrigatória.", {}, 401);
  }

  const { id: pickId } = await params;
  if (!pickId) {
    return errorResponse("pick id obrigatório.", {}, 400);
  }

  let body: ReqBody;
  try {
    body = (await request.json()) as ReqBody;
  } catch {
    return errorResponse("Corpo inválido (JSON esperado).", {}, 400);
  }

  const incoming = Array.isArray(body.legs) ? body.legs : [];
  // Valida legs
  for (const l of incoming) {
    if (!l.player_name || !l.market) {
      return errorResponse(
        "Cada perna precisa de player_name e market.",
        {},
        400
      );
    }
    if (!STATUS_VALUES.includes(l.result_status)) {
      return errorResponse(
        `result_status inválido: ${l.result_status}`,
        {},
        400
      );
    }
  }

  const admin = getSupabaseAdmin();

  // Confirma que pick existe
  const { data: pick, error: pErr } = await admin
    .from("public_picks")
    .select("id")
    .eq("id", pickId)
    .maybeSingle();
  if (pErr) {
    return errorResponse(`Erro ao buscar pick: ${pErr.message}`, {}, 500);
  }
  if (!pick) {
    return errorResponse("Pick não encontrada.", { id: pickId }, 404);
  }

  // Refresh idempotente: deleta legs e insere as novas.
  const { error: delErr } = await admin
    .from("public_pick_legs")
    .delete()
    .eq("pick_id", pickId);
  if (delErr) {
    return errorResponse(
      `Erro ao limpar legs antigas: ${delErr.message}`,
      {},
      500
    );
  }

  if (incoming.length > 0) {
    const rows = incoming.map((l, i) => ({
      pick_id: pickId,
      position: l.position ?? i + 1,
      player_name: l.player_name,
      market: l.market,
      line: l.line,
      odd: l.odd,
      actual_value: l.actual_value,
      result_status: l.result_status,
      result_notes: l.result_notes,
    }));
    const { error: insErr } = await admin.from("public_pick_legs").insert(rows);
    if (insErr) {
      return errorResponse(
        `Erro ao inserir legs: ${insErr.message}`,
        {},
        500
      );
    }
  }

  // Recalcula status geral + notes do pick.
  const computed = recomputePickStatus(incoming);
  const { error: upErr } = await admin
    .from("public_picks")
    .update({
      status: computed.status,
      result_notes: computed.notes,
    })
    .eq("id", pickId);
  if (upErr) {
    return errorResponse(
      `Erro ao atualizar pick: ${upErr.message}`,
      {},
      500
    );
  }

  return okResponse({
    pick_id: pickId,
    new_status: computed.status,
    new_notes: computed.notes,
    legs_count: incoming.length,
  });
}
