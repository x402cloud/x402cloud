import { describe, it, expect } from "vitest";
import {
  inferManifest,
  inferEntries,
  wholesaleTextCost,
  wholesaleEmbedCost,
  QUOTE_INPUT_TOKENS,
  QUOTE_OUTPUT_TOKENS,
  QUOTE_EMBED_TOKENS,
} from "../src/index.js";
import type { ManifestParams } from "../src/index.js";

const params: ManifestParams = {
  network: "eip155:84532",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  payTo: "0x207C6D8f63Bf01F70dc6D372693E8D5943848E88",
  facilitator: "https://facilitator.x402cloud.ai",
  baseUrl: "https://infer.x402cloud.ai",
};

describe("inferManifest", () => {
  it("returns at least one service", () => {
    expect(inferManifest(params).length).toBeGreaterThan(0);
  });

  it("every entry uses the operator wallet as payTo", () => {
    for (const s of inferManifest(params)) {
      expect(s.payment.payTo).toBe(params.payTo);
    }
  });

  it("entries(p) and manifest(p) agree on id+maxPrice pairs", () => {
    const cat = inferManifest(params);
    const ent = inferEntries(params);
    expect(ent.length).toBe(cat.length);
    const m = new Map(cat.map((s) => [s.id, s.payment.maxPrice]));
    for (const e of ent) {
      expect(e.maxPrice).toBe(m.get(e.id));
    }
  });

  it("never quotes $0 — a priceless route is a free route", () => {
    for (const s of inferManifest(params)) {
      expect(Number(s.payment.maxPrice.replace(/[$,\s]/g, ""))).toBeGreaterThan(0);
    }
  });
});

describe("sub-micro work still costs something", () => {
  // A single-token `nano` request used to meter to exactly 0 micro-USDC, and a
  // zero settlement skips the on-chain transfer entirely — the request was
  // served for free. Truncation is fine; truncation to nothing is not.
  it("floors non-zero text work at 1 micro-USDC", () => {
    const neurons = { inputPerMillion: 1, outputPerMillion: 1 };

    expect(wholesaleTextCost(neurons, 1, 0)).toBe("1");
    expect(wholesaleTextCost(neurons, 0, 1)).toBe("1");
  });

  it("floors non-zero embedding work at 1 micro-USDC", () => {
    expect(wholesaleEmbedCost({ inputPerMillion: 1, outputPerMillion: 0 }, 1)).toBe("1");
  });

  it("still charges nothing when no work was done", () => {
    const neurons = { inputPerMillion: 10_000, outputPerMillion: 50_000 };

    expect(wholesaleTextCost(neurons, 0, 0)).toBe("0");
    expect(wholesaleEmbedCost(neurons, 0)).toBe("0");
  });

  it("leaves amounts above 1 micro-USDC exactly as computed", () => {
    const neurons = { inputPerMillion: 1_075, outputPerMillion: 0 };

    expect(wholesaleEmbedCost(neurons, 8192)).toBe("96");
  });
});

describe("quote assumptions", () => {
  // apps/infer caps `max_tokens` against these same constants. If the cap and
  // the quote read different numbers, the service invites a request its own
  // price never covered.
  it("are the numbers the quote is actually built from", () => {
    expect([QUOTE_INPUT_TOKENS, QUOTE_OUTPUT_TOKENS, QUOTE_EMBED_TOKENS]).toEqual([500, 2000, 8192]);
  });
});
