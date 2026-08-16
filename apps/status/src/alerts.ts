import type { ProbeReport, SettlementSummary } from "@x402cloud/probes";

/**
 * A settlement-failure spike, per docs/MAINNET-RUNBOOK.md §7 ("> 5
 * settlement failures"). The runbook's ideal window is 5 minutes; this
 * dashboard's settlement health is a 24h rollup (see ticket scope), so this
 * threshold is coarser than the runbook's target — a follow-up could add a
 * short-window count if the 24h view proves too slow to catch a spike.
 */
export const SETTLEMENT_FAILURE_SPIKE_THRESHOLD = 5;

export type AlertCondition = {
  kind: "gas-low" | "probe-fail" | "settlement-failures";
  message: string;
};

/** Alerts derived from one target's probe run: low facilitator gas, or any probe failing. */
export function evaluateProbeAlerts(target: string, report: ProbeReport): AlertCondition[] {
  const conditions: AlertCondition[] = [];

  const gasProbe = report.results.find((r) => r.name === "gas-estimate");
  if (gasProbe && (gasProbe.status === "fail" || gasProbe.status === "warn")) {
    conditions.push({
      kind: "gas-low",
      message: `[${target}] facilitator ETH balance low${gasProbe.error ? `: ${gasProbe.error}` : ""}`,
    });
  }

  if (report.summary.fail > 0) {
    const failing = report.results
      .filter((r) => r.status === "fail")
      .map((r) => r.name)
      .join(", ");
    conditions.push({
      kind: "probe-fail",
      message: `[${target}] ${report.summary.fail} probe(s) failing: ${failing}`,
    });
  }

  return conditions;
}

/** The settlement-failure-spike alert. Global (not per-target) — settlement KV isn't network-scoped. */
export function evaluateSettlementAlert(settlements: SettlementSummary): AlertCondition | null {
  if (!settlements.available) return null;
  if (settlements.failed < SETTLEMENT_FAILURE_SPIKE_THRESHOLD) return null;

  return {
    kind: "settlement-failures",
    message: `${settlements.failed} settlement failures in the last ${settlements.windowHours}h (threshold ${SETTLEMENT_FAILURE_SPIKE_THRESHOLD})`,
  };
}

export function formatAlertMessage(conditions: AlertCondition[]): string {
  return ["x402cloud status alert", ...conditions.map((c) => `- ${c.message}`)].join("\n");
}
