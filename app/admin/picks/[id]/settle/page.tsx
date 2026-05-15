import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { Navbar } from "@/components/navbar";
import { SettleForm } from "./settle-form";

export const dynamic = "force-dynamic";

interface PickRow {
  id: string;
  pick_date: string;
  match_name: string;
  league_name: string | null;
  risk_level: "safe" | "value" | "mega";
  status: "draft" | "published" | "green" | "red" | "void";
  odd_target: number | null;
  rationale: string | null;
  result_notes: string | null;
  markets: unknown;
}

interface LegRow {
  id: string;
  position: number;
  player_name: string;
  market: string;
  line: number | null;
  odd: number | null;
  actual_value: string | null;
  result_status: "pending" | "green" | "red" | "void";
  result_notes: string | null;
}

export default async function SettlePickPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  // Service role para garantir leitura completa (RLS de SELECT já é
  // aberta, mas mantém consistência com o endpoint de settle).
  const admin = getSupabaseAdmin();
  const { data: pick } = await admin
    .from("public_picks")
    .select(
      "id, pick_date, match_name, league_name, risk_level, status, odd_target, rationale, result_notes, markets"
    )
    .eq("id", id)
    .maybeSingle<PickRow>();

  if (!pick) notFound();

  const { data: legsData } = await admin
    .from("public_pick_legs")
    .select(
      "id, position, player_name, market, line, odd, actual_value, result_status, result_notes"
    )
    .eq("pick_id", pick.id)
    .order("position", { ascending: true });
  const legs = (legsData ?? []) as LegRow[];

  // Defaults a partir de markets[] se ainda não houver legs salvas.
  const fallbackFromMarkets = Array.isArray(pick.markets)
    ? (pick.markets as Array<{ player?: string; market?: string }>).map(
        (m, i) => ({
          id: `synthetic-${i}`,
          position: i + 1,
          player_name: String(m.player ?? "?"),
          market: String(m.market ?? "?"),
          line: null,
          odd: null,
          actual_value: null,
          result_status: "pending" as const,
          result_notes: null,
        })
      )
    : [];

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="container max-w-2xl space-y-5 py-8">
        <div>
          <Link
            href="/picks"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← voltar para Picks
          </Link>
          <h1 className="mt-1 text-2xl font-bold">Marcar resultado</h1>
          <p className="text-sm text-muted-foreground">
            {pick.match_name} · {pick.league_name ?? "?"} ·{" "}
            {pick.pick_date}
          </p>
          <p className="text-xs text-muted-foreground">
            Status atual: <span className="font-medium">{pick.status}</span>
            {pick.odd_target ? ` · odd alvo ${Number(pick.odd_target).toFixed(2)}` : ""}
          </p>
        </div>

        <SettleForm
          pickId={pick.id}
          existingLegs={legs}
          marketsFallback={fallbackFromMarkets}
        />
      </main>
    </div>
  );
}
