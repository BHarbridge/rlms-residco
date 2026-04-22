import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { Link } from "wouter";

interface Freshness {
  currentYear: number;
  currentQuarter: number;
  currentQuarterCode: number;
  currentQuarterLabel: string;
  priorYear: number;
  staleTables: string[];
  isStale: boolean;
}

function tableLabels(priorYear: number): Record<string, { short: string; what: string }> {
  return {
    cost_factors: { short: "Cost Factors", what: `${priorYear} cost factor (Rule 107.E.2 — prior year)` },
    salvage_quarters: { short: "Salvage Rates", what: "quarterly scrap & dismantling prices" },
  };
}

/**
 * Amber warning banner — fires when the current calendar quarter/year has no
 * corresponding rows in the AAR reference tables, meaning new calcs may use
 * last quarter's prices. Disappears automatically the moment those rows are
 * added on the Reference page.
 *
 * Mounted at the top of every DV Calculator route.
 */
export default function FreshnessBanner({ hideLink }: { hideLink?: boolean } = {}) {
  const { data } = useQuery<Freshness>({
    queryKey: ["/api/reference/freshness"],
    // Re-check often so banner disappears ~instantly after rows are added
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (!data || !data.isStale) return null;

  const labels = tableLabels(data.priorYear ?? data.currentYear - 1);
  const items = data.staleTables.map((t) => labels[t]?.short || t).join(" · ");
  const details = data.staleTables.map((t) => labels[t]?.what || t).join(", ");

  return (
    <div
      role="alert"
      className="flex items-start gap-3 px-4 md:px-6 py-3 border-b border-amber-500/30 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100 text-[13px] leading-relaxed"
      data-testid="banner-freshness"
    >
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">
          {data.currentQuarterLabel} AAR reference data not yet loaded
        </div>
        <div className="text-amber-800 dark:text-amber-200/90 mt-0.5">
          Calculations for incidents in {data.currentQuarterLabel} will fall back to the most recent prior data until{" "}
          <span className="font-medium">{items}</span> ({details}) are added. Values may be incorrect.
        </div>
      </div>
      {!hideLink && (
        <Link
          href="/reference"
          className="shrink-0 inline-flex items-center gap-1 text-amber-900 dark:text-amber-100 font-medium hover:underline whitespace-nowrap"
          data-testid="link-banner-reference"
        >
          Update now <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}
