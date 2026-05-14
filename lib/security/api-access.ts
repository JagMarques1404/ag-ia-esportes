import "@/lib/server-only-guard";
import type { User } from "@supabase/supabase-js";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";

export type AccessMode = "cron" | "user";

export interface AccessGranted {
  ok: true;
  mode: AccessMode;
  userId?: string;
}

export interface AccessDenied {
  ok: false;
  reason: string;
}

export type AccessResult = AccessGranted | AccessDenied;

/**
 * Recupera o usuário Supabase a partir dos cookies de sessão presentes
 * na request atual. Retorna null se não houver sessão ou se a session
 * tiver expirado.
 *
 * Funciona apenas dentro de Route Handlers / Server Components / Server
 * Actions — porque depende de `cookies()` do next/headers.
 */
export async function getCurrentUser(): Promise<User | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user ?? null;
  } catch {
    return null;
  }
}

/**
 * Aceita a request se houver:
 *   1) Authorization: Bearer ${CRON_SECRET}
 *   2) x-cron-secret: ${CRON_SECRET}
 *   3) Sessão Supabase autenticada (cookies)
 *
 * Em desenvolvimento (NODE_ENV !== 'production') sem CRON_SECRET no
 * servidor, NÃO libera silenciosamente — exige sessão. CRON_SECRET é
 * a única coisa que dispensa login. Esta diferença é proposital:
 * lib/security/cron.ts (mais permissivo em dev) é para o endpoint
 * /api/cron/sync, lib/security/api-access.ts é para tudo o mais.
 */
export async function validateInternalApiAccess(
  request: Request
): Promise<AccessResult> {
  const expected = process.env.CRON_SECRET;

  if (expected) {
    const authHeader = request.headers.get("authorization");
    const customHeader = request.headers.get("x-cron-secret");

    const bearer =
      authHeader && authHeader.toLowerCase().startsWith("bearer ")
        ? authHeader.slice(7).trim()
        : null;

    if (bearer === expected || customHeader === expected) {
      return { ok: true, mode: "cron" };
    }
  }

  const user = await getCurrentUser();
  if (user) {
    return { ok: true, mode: "user", userId: user.id };
  }

  return {
    ok: false,
    reason: "Não autorizado: requer CRON_SECRET válido ou sessão autenticada.",
  };
}
