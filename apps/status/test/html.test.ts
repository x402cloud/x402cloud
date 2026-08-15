import { describe, it, expect } from "vitest";
import type { ProbeReport, SettlementSummary } from "@x402cloud/probes";
import { renderDashboard } from "../src/html.js";

function report(overrides: Partial<ProbeReport> = {}): ProbeReport {
  return {
    target: "testnet",
    timestamp: new Date().toISOString(),
    results: [
      { name: "rpc-alive", status: "pass", latencyMs: 12, meta: { blockNumber: "0x1" } },
      {
        name: "gas-estimate",
        status: "pass",
        latencyMs: 30,
        meta: { address: "0x207C6D8f63Bf01F70dc6D372693E8D5943848E88", balanceWei: "1", balanceEth: "0.5" },
      },
      {
        name: "usdc-balance",
        status: "pass",
        latencyMs: 20,
        meta: {
          address: "0x207C6D8f63Bf01F70dc6D372693E8D5943848E88",
          network: "eip155:84532",
          balanceUsdc: "12.500000",
        },
      },
    ],
    summary: { pass: 3, fail: 0, warn: 0, skip: 0 },
    ...overrides,
  };
}

const unavailable: SettlementSummary = { available: false };
const available: SettlementSummary = {
  available: true,
  windowHours: 24,
  settled: 10,
  failed: 2,
  pending: 1,
  total: 13,
  truncated: false,
};

describe("renderDashboard", () => {
  it("renders a wallet tile for the gas balance and the usdc balance", () => {
    const html = renderDashboard(report(), ["testnet", "mainnet"], unavailable);
    expect(html).toContain("0.5 ETH");
    expect(html).toContain("12.500000 USDC");
    expect(html).toContain("Facilitator gas (ETH)");
    expect(html).toContain("Operator revenue (USDC)");
  });

  it("does not render gas-estimate/usdc-balance a second time in the generic probe list", () => {
    const html = renderDashboard(report(), ["testnet"], unavailable);
    const probesSection = html.split('<div class="probes">')[1];
    expect(probesSection).not.toContain("gas-estimate");
    expect(probesSection).not.toContain("usdc-balance");
    expect(probesSection).toContain("rpc-alive");
  });

  it("shows 'not available' for settlement health when the summary is unavailable", () => {
    const html = renderDashboard(report(), ["testnet"], unavailable);
    expect(html).toContain("Settlement health");
    expect(html).toContain("not available");
  });

  it("renders settled/failed/pending counts when settlement health is available", () => {
    const html = renderDashboard(report(), ["testnet"], available);
    expect(html).toContain("10 settled");
    expect(html).toContain("2 failed");
    expect(html).toContain("1 pending");
  });

  it("shows 'not available' for a wallet tile whose probe result is missing", () => {
    const r = report({
      results: [{ name: "rpc-alive", status: "pass", latencyMs: 1 }],
      summary: { pass: 1, fail: 0, warn: 0, skip: 0 },
    });
    const html = renderDashboard(r, ["testnet"], unavailable);
    expect(html).toContain("not available");
  });

  it("escapes probe error text and meta values", () => {
    const r = report({
      results: [{ name: "rpc-alive", status: "fail", latencyMs: 1, error: "<script>alert(1)</script>" }],
      summary: { pass: 0, fail: 1, warn: 0, skip: 0 },
    });
    const html = renderDashboard(r, ["testnet"], unavailable);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
