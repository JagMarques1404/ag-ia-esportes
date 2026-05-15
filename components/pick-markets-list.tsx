import { CheckCircle2Icon, XCircleIcon, MinusCircleIcon, ClockIcon } from "lucide-react";
import type { DailyPick, PickLegResult, PickLegStatus } from "@/lib/ai/analyst-tools";

const STATUS_ICON: Record<
  PickLegStatus,
  { Icon: typeof CheckCircle2Icon; cls: string }
> = {
  green: { Icon: CheckCircle2Icon, cls: "text-green-400" },
  red: { Icon: XCircleIcon, cls: "text-destructive" },
  void: { Icon: MinusCircleIcon, cls: "text-muted-foreground" },
  pending: { Icon: ClockIcon, cls: "text-muted-foreground" },
};

const STATUS_LABEL: Record<PickLegStatus, string> = {
  green: "Green",
  red: "Red",
  void: "Void",
  pending: "Pendente",
};

/**
 * Renderiza a lista de mercados de uma pick. Se a pick tiver
 * `legs` (de public_pick_legs) usa esses dados com status real
 * por perna; caso contrário, cai para `markets` (JSON snapshot)
 * mostrando todas como "Pendente".
 */
export function PickMarketsList({
  pick,
  compact = false,
  limit,
}: {
  pick: DailyPick;
  compact?: boolean;
  limit?: number;
}) {
  const hasLegs = !!(pick.legs && pick.legs.length > 0);
  const items: PickLegResult[] = hasLegs
    ? pick.legs!
    : pick.markets.map((m, i) => ({
        id: `synthetic-${i}`,
        position: i + 1,
        player_name: m.player,
        market: m.market,
        line: null,
        odd: null,
        actual_value: null,
        result_status: "pending" as PickLegStatus,
        result_notes: null,
      }));

  const visible = typeof limit === "number" ? items.slice(0, limit) : items;

  return (
    <ul className="space-y-1.5 text-sm">
      {visible.map((leg) => {
        const { Icon, cls } = STATUS_ICON[leg.result_status];
        return (
          <li key={leg.id} className="flex items-start gap-2">
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${cls}`} />
            <div className="min-w-0 flex-1">
              <div>
                <span className="font-medium">{leg.player_name}</span>{" "}
                <span className="text-muted-foreground">{leg.market}</span>
                {!compact && leg.result_status !== "pending" && (
                  <span className={`ml-2 text-[11px] font-medium ${cls}`}>
                    · {STATUS_LABEL[leg.result_status]}
                  </span>
                )}
              </div>
              {!compact && leg.actual_value && (
                <div className="text-[11px] text-muted-foreground">
                  fez/observado: <strong>{leg.actual_value}</strong>
                </div>
              )}
              {!compact && leg.result_notes && (
                <div className="text-[11px] text-muted-foreground">
                  {leg.result_notes}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
