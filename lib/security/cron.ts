import "server-only";

export interface CronValidationResult {
  ok: boolean;
  reason?: string;
}

/**
 * Aceita o token via:
 *   - Authorization: Bearer ${CRON_SECRET}
 *   - x-cron-secret: ${CRON_SECRET}
 *
 * Em desenvolvimento (NODE_ENV !== 'production'), permite acesso sem token
 * com warning no log. Em produção, ausência de CRON_SECRET no servidor é
 * tratada como erro de configuração — bloqueia.
 */
export function validateCronSecret(request: Request): CronValidationResult {
  const expected = process.env.CRON_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  if (!expected) {
    if (!isProd) {
      console.warn(
        "[cron] CRON_SECRET não definido — permitindo em desenvolvimento."
      );
      return { ok: true };
    }
    return {
      ok: false,
      reason: "CRON_SECRET não configurado no servidor.",
    };
  }

  const authHeader = request.headers.get("authorization");
  const customHeader = request.headers.get("x-cron-secret");

  const authToken =
    authHeader && authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : null;

  if (authToken === expected || customHeader === expected) {
    return { ok: true };
  }
  return { ok: false, reason: "Token inválido ou ausente." };
}
