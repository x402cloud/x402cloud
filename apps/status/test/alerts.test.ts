import { describe, it, expect } from "vitest";
import type { ProbeReport, SettlementSummary } from "@x402cloud/probes";
import {
  evaluateProbeAlerts,
  evaluateSettlementAlert,
  formatAlertMessage,
  SETTLEMENT_FAILURE_SPIKE_THRESHOLD,
} from "../src/alerts.js";

function report(overrides: Partial<ProbeReport> = {}): ProbeReport {
  return {
    target: "testnet",
    timestamp: new Date().toISOString(),
    results: [],
    summary: { pass: 0, fail: 0, warn: 0, skip: 0 },
    ...overrides,
  };
}

describe("evaluateProbeAlerts", () => {
  it("returns no conditions for an all-green report", () => {
    const r = report({
      results: [{ name: "gas-estimate", status: "pass", latencyMs: 1, meta: { balanceEth: "1.0" } }],
      summary: { pass: 1, fail: 0, warn: 0, skip: 0 },
    });
    expect(evaluateProbeAlerts("testnet", r)).toEqual([]);
  });

  it("flags a low or empty facilitator gas balance", () => {
    const r = report({
      results: [{ name: "gas-estimate", status: "warn", latencyMs: 1, error: "low" }],
      summary: { pass: 0, fail: 0, warn: 1, skip: 0 },
    });
    const conditions = evaluateProbeAlerts("testnet", r);
    expect(conditions).toHaveLength(1);
    expect(conditions[0].kind).toBe("gas-low");
    expect(conditions[0].message).toContain("testnet");
    expect(conditions[0].message).toContain("low");
  });

  it("does not flag gas-estimate when it is skipped (no facilitator configured)", () => {
    const r = report({
      results: [{ name: "gas-estimate", status: "skip", latencyMs: 0 }],
      summary: { pass: 0, fail: 0, warn: 0, skip: 1 },
    });
    expect(evaluateProbeAlerts("mainnet", r)).toEqual([]);
  });

  it("flags any probe failure, naming the failing probes", () => {
    const r = report({
      results: [
        { name: "rpc-alive", status: "fail", latencyMs: 1, error: "timeout" },
        { name: "usdc-contract", status: "fail", latencyMs: 1, error: "timeout" },
        { name: "permit2-contract", status: "pass", latencyMs: 1 },
      ],
      summary: { pass: 1, fail: 2, warn: 0, skip: 0 },
    });
    const conditions = evaluateProbeAlerts("testnet", r);
    expect(conditions).toHaveLength(1);
    expect(conditions[0].kind).toBe("probe-fail");
    expect(conditions[0].message).toContain("rpc-alive");
    expect(conditions[0].message).toContain("usdc-contract");
  });

  it("can report both a low-gas and a probe-fail condition together", () => {
    const r = report({
      results: [
        { name: "gas-estimate", status: "fail", latencyMs: 1, error: "zero balance" },
        { name: "rpc-alive", status: "fail", latencyMs: 1, error: "down" },
      ],
      summary: { pass: 0, fail: 2, warn: 0, skip: 0 },
    });
    const conditions = evaluateProbeAlerts("testnet", r);
    expect(conditions.map((c) => c.kind).sort()).toEqual(["gas-low", "probe-fail"]);
  });
});

describe("evaluateSettlementAlert", () => {
  it("returns null when settlement health is unavailable", () => {
    expect(evaluateSettlementAlert({ available: false })).toBeNull();
  });

  it("returns null when failures are below the spike threshold", () => {
    const summary: SettlementSummary = {
      available: true,
      windowHours: 24,
      settled: 100,
      failed: SETTLEMENT_FAILURE_SPIKE_THRESHOLD - 1,
      pending: 0,
      total: 100 + SETTLEMENT_FAILURE_SPIKE_THRESHOLD - 1,
      truncated: false,
    };
    expect(evaluateSettlementAlert(summary)).toBeNull();
  });

  it("fires at the spike threshold", () => {
    const summary: SettlementSummary = {
      available: true,
      windowHours: 24,
      settled: 10,
      failed: SETTLEMENT_FAILURE_SPIKE_THRESHOLD,
      pending: 0,
      total: 10 + SETTLEMENT_FAILURE_SPIKE_THRESHOLD,
      truncated: false,
    };
    const condition = evaluateSettlementAlert(summary);
    expect(condition).not.toBeNull();
    expect(condition?.kind).toBe("settlement-failures");
    expect(condition?.message).toContain(String(SETTLEMENT_FAILURE_SPIKE_THRESHOLD));
  });
});

describe("formatAlertMessage", () => {
  it("joins conditions under one header, one bullet per condition", () => {
    const message = formatAlertMessage([
      { kind: "gas-low", message: "gas low" },
      { kind: "probe-fail", message: "probes failing" },
    ]);
    expect(message).toBe("x402cloud status alert\n- gas low\n- probes failing");
  });

  it("still returns just the header for an empty condition list", () => {
    expect(formatAlertMessage([])).toBe("x402cloud status alert");
  });
});
