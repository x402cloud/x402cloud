import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveFacilitatorAddress } from "../src/probes/address.js";
import type { Target } from "../src/types.js";

const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", mockFetch);

const baseTarget: Target = {
  name: "test-net",
  rpc: "https://example.com/rpc",
  facilitator: "https://example.com/facilitator",
  infer: null,
  network: "eip155:84532",
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe("resolveFacilitatorAddress", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns the target's explicit override without calling fetch", async () => {
    const target: Target = { ...baseTarget, facilitatorAddress: "0xabc" };
    const result = await resolveFacilitatorAddress(target, new AbortController().signal);
    expect(result).toEqual({ ok: true, address: "0xabc" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fails when the target has no facilitator URL", async () => {
    const target: Target = { ...baseTarget, facilitator: null };
    const result = await resolveFacilitatorAddress(target, new AbortController().signal);
    expect(result).toEqual({ ok: false, error: "Target has no facilitator URL configured" });
  });

  it("fetches /supported and reads the facilitator address", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ facilitator: "0xdef", schemes: ["upto"] }));
    const result = await resolveFacilitatorAddress(baseTarget, new AbortController().signal);
    expect(result).toEqual({ ok: true, address: "0xdef" });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/facilitator/supported",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("falls back to the legacy 'address' field when 'facilitator' is absent", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ address: "0x999" }));
    const result = await resolveFacilitatorAddress(baseTarget, new AbortController().signal);
    expect(result).toEqual({ ok: true, address: "0x999" });
  });

  it("fails when /supported returns a non-ok status", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, false, 503));
    const result = await resolveFacilitatorAddress(baseTarget, new AbortController().signal);
    expect(result).toEqual({ ok: false, error: "Could not fetch facilitator address: 503" });
  });

  it("fails when /supported returns neither address field", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ schemes: ["upto"] }));
    const result = await resolveFacilitatorAddress(baseTarget, new AbortController().signal);
    expect(result).toEqual({ ok: false, error: "Facilitator did not return an address" });
  });
});
