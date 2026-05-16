import "@/lib/server-only-guard";

/**
 * Abstração mínima sobre fontes de dados de futebol.
 *
 * Hoje só temos API-Football (free plan). O wrapper deixa explícito o
 * "contract" mínimo que o motor de auto-picks depende, para que um
 * provider alternativo futuro (SportMonks, Sofascore scrape etc.) possa
 * implementar a mesma interface sem mexer no orquestrador.
 *
 * Importante: este módulo NÃO faz cache nem dedupe nem retries. Toda
 * lógica de quota / cache continua nas funções subjacentes em
 * lib/api-football/*. Esta camada é só um "alias estável".
 */

import {
  syncFixturesByDate as apiFootballSyncFixturesByDate,
  syncFixtureLineups as apiFootballSyncFixtureLineups,
  type SyncFixturesByDateResult,
  type SyncFixtureLineupsResult,
} from "@/lib/api-football/sync";

export type ProviderName = "api-football";

export interface FootballDataProvider {
  getProviderName(): ProviderName;
  /** Garante que os fixtures da data estão em football_fixtures. Custa 1 req. */
  syncFixturesByDate(date: string): Promise<SyncFixturesByDateResult>;
  /** Garante lineups (titulares + reservas) do fixture. Custa 1 req. */
  syncFixtureLineups(
    apiFixtureId: number
  ): Promise<SyncFixtureLineupsResult>;
}

export function getActiveProvider(): FootballDataProvider {
  return {
    getProviderName: () => "api-football",
    syncFixturesByDate: (date) => apiFootballSyncFixturesByDate(date),
    syncFixtureLineups: (apiFixtureId) =>
      apiFootballSyncFixtureLineups(apiFixtureId),
  };
}
