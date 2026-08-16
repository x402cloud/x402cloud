import { describe, it, expect, vi, beforeEach } from "vitest";
import { usdcBalance } from "../src/probes/usdc-balance.js";
import type { Target } from "../src/types.js";

const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

const baseTarget: Target = {
  name: "testnet",
  rpc: "https://example.com/rpc",
  facilitator: "https://example.com/facilitator",
  infer: null,
  network: "eip155:84532",
  operatorAddress: "0x207C6D8f63Bf01F70dc6D372693E8D5943848E88",
};

describe("usdcBalance", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("skips when the network has no known USDC address", async () => {
    const target: Target = { ...baseTarget, network: "eip155:999999" };
    const result = await usdcBalance(target);
    expect(result.status).toBe("skip");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("reports the balance formatted to 6 decimals using the target's operatorAddress", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ result: "0x000000000000000000000000000000000000000000000000000000003b9aca00" }),
    );
    const result = await usdcBalance(baseTarget);
    expect(result.status).toBe("pass");
    expect(result.meta).toMatchObject({
      address: baseTarget.operatorAddress,
      network: "eip155:84532",
      balanceUsdc: "1000.000000",
    });
    const [rpcUrl, init] = mockFetch.mock.calls[0];
    expect(rpcUrl).toBe("https://example.com/rpc");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.method).toBe("eth_call");
    expect(body.params[0].data.startsWith("0x70a08231")).toBe(true);
  });

  it("falls back to resolveFacilitatorAddress when no operatorAddress is set", async () => {
    const target: Target = { ...baseTarget, operatorAddress: undefined };
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ facilitator: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }))
      .mockResolvedValueOnce(jsonResponse({ result: "0x0" }));
    const result = await usdcBalance(target);
    expect(result.status).toBe("pass");
    expect(result.meta?.address).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("skips when no operatorAddress is set and the facilitator address can't be resolved", async () => {
    const target: Target = { ...baseTarget, operatorAddress: undefined, facilitator: null };
    const result = await usdcBalance(target);
    expect(result.status).toBe("skip");
  });

  it("fails on an RPC error", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: { message: "rate limited" } }));
    const result = await usdcBalance(baseTarget);
    expect(result.status).toBe("fail");
    expect(result.error).toBe("rate limited");
  });
});
