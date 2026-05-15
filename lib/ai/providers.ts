import "@/lib/server-only-guard";

/**
 * Detector de provider de IA. Server-only.
 * Nunca importar no client — chave de API leak.
 *
 * Ordem de prioridade:
 *   1. Anthropic (se ANTHROPIC_API_KEY válida)
 *   2. OpenAI (estrutura preparada, sem implementação ainda)
 *   3. Fallback determinístico (intent parser do AG IA)
 */

export type ProviderName = "anthropic" | "openai" | "fallback";

export interface ActiveProvider {
  name: ProviderName;
  /** Modelo escolhido (apenas para anthropic/openai). */
  model?: string;
}

/**
 * Default Anthropic. Deixar travado em sonnet por custo×qualidade
 * razoável. Para forçar outro modelo, setar ANTHROPIC_MODEL na env.
 */
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

function looksLikeKey(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length >= 16;
}

export function getActiveProvider(): ActiveProvider {
  if (looksLikeKey(process.env.ANTHROPIC_API_KEY)) {
    return {
      name: "anthropic",
      model: process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL,
    };
  }
  if (looksLikeKey(process.env.OPENAI_API_KEY)) {
    return {
      name: "openai",
      model: process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
    };
  }
  return { name: "fallback" };
}

/**
 * Indica se algum provider real está configurado. Útil para mostrar
 * banner "Modo fallback ativo" na UI.
 */
export function hasRealProvider(): boolean {
  const p = getActiveProvider();
  return p.name === "anthropic" || p.name === "openai";
}
