import "@/lib/server-only-guard";
import { type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/security/api-access";
import { okResponse, errorResponse } from "@/lib/api/response";
import { processOneFixture } from "@/lib/player-intel/fixture-processor";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * POST /api/studio/force-analyze
 *
 * Body:
 *   {
 *     "apiFixtureId": 1492266,           // específico — processa só esse
 *     // OU
 *     "date": "2026-05-17",              // processa fixtures do dia
 *     "fromTime": "18:30",                // opcional, BR
 *     "futureOnly": true,                 // opcional
 *     "maxFixtures": 10                   // default 10
 *   }
 *
 * Retorna snapshot completo (lineup, history, sample3, dq, strong,
 * readiness, blocked_reason, picks).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ReqBody {
  apiFixtureId?: number;
  date?: string;
  fromTime?: string;
  futureOnly?: boolean;
  maxFixtures?: number;
  dryRun?: boolean;
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return errorResponse("Não autorizado", {}, 401);

  let body: ReqBody = {};
  try {
    body = (await request.json()) as ReqBody;
  } catch {
    // body opcional
  }

  const dryRun = body.dryRun === true;
  const maxFixtures = body.maxFixtures ?? 10;

  try {
    if (body.apiFixtureId != null) {
      // Single fixture
      const snap = await processOneFixture({
        apiFixtureId: body.apiFixtureId,
        dryRun,
        last: 5,
        persistSchedule: true,
      });
      return okResponse(
        { snapshots: [snap] },
        { apiFixtureId: body.apiFixtureId, dryRun }
      );
    }

    // Múltiplos fixtures do dia
    const date = body.date ?? (() => {
      const n = new Date(Date.now() - 3 * 60 * 60_000);
      return n.toISOString().split("T")[0];
    })();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return errorResponse("date inválido", {}, 400);
    }

    const sb = getSupabaseAdmin();
    const dayStart = `${date}T03:00:00Z`;
    const nextDate = (() => {
      const d = new Date(`${date}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().split("T")[0];
    })();
    const dayEnd = `${nextDate}T03:00:00Z`;

    const { data: catalogIds } = await sb
      .from("football_leagues_catalog")
      .select("api_league_id")
      .eq("is_auto_pick", true);
    const autoPickIds = (catalogIds ?? [])
      .map((r) => Number(r.api_league_id))
      .filter((n) => Number.isFinite(n));

    function buildQ() {
      let q = sb
        .from("football_fixtures")
        .select("api_fixture_id, kickoff_at")
        .order("kickoff_at", { ascending: true, nullsFirst: false });
      if (autoPickIds.length > 0) q = q.in("api_league_id", autoPickIds);
      return q;
    }
    const [byDate, byKick] = await Promise.all([
      buildQ().eq("date", date),
      buildQ().gte("kickoff_at", dayStart).lt("kickoff_at", dayEnd),
    ]);

    const merged = new Map<
      number,
      { api_fixture_id: number; kickoff_at: string | null }
    >();
    for (const r of (byDate.data ?? []) as Array<{
      api_fixture_id: number;
      kickoff_at: string | null;
    }>)
      merged.set(r.api_fixture_id, r);
    for (const r of (byKick.data ?? []) as Array<{
      api_fixture_id: number;
      kickoff_at: string | null;
    }>)
      if (!merged.has(r.api_fixture_id)) merged.set(r.api_fixture_id, r);

    let fixtures = Array.from(merged.values());
    const now = new Date();
    if (body.futureOnly) {
      fixtures = fixtures.filter(
        (f) => f.kickoff_at != null && new Date(f.kickoff_at) > now
      );
    }
    if (body.fromTime && /^\d{2}:\d{2}$/.test(body.fromTime)) {
      const cutoffBr = new Date(`${date}T${body.fromTime}:00-03:00`);
      fixtures = fixtures.filter(
        (f) => f.kickoff_at != null && new Date(f.kickoff_at) >= cutoffBr
      );
    }
    fixtures = fixtures
      .sort((a, b) => (a.kickoff_at ?? "").localeCompare(b.kickoff_at ?? ""))
      .slice(0, maxFixtures);

    const snapshots = [];
    for (const fx of fixtures) {
      try {
        const snap = await processOneFixture({
          apiFixtureId: fx.api_fixture_id,
          dryRun,
          last: 5,
          persistSchedule: true,
        });
        snapshots.push(snap);
      } catch (err) {
        snapshots.push({
          api_fixture_id: fx.api_fixture_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return okResponse(
      { snapshots, processed: snapshots.length },
      { date, dryRun, futureOnly: body.futureOnly ?? false, fromTime: body.fromTime ?? null }
    );
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : "Erro",
      {},
      500
    );
  }
}
