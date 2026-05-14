import { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Exclui /api/* do middleware: rotas de backend têm sua própria auth
  // (CRON_SECRET no caso de /api/cron/*; /api/football/* fica aberto
  // até a Fase 3, quando vai migrar para SERVICE_ROLE-only).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
