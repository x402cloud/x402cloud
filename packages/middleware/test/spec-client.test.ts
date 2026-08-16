import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { buildUptoMiddleware, type VerifyFn, type SettleFn } from "../src/core.js";
import type { UptoRoutesConfig } from "../src/types.js";

// @x402cloud/protocol is NOT mocked: it is zero-dependency and pure, and its
// encoding is precisely what a foreign client has to be able to read.
vi.mock("@x402cloud/evm", async () => {
  const actual = await import("@x402cloud/evm");
  return {
    DEFAULT_USDC_ADDRESSES: {
      "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    },
    parseUptoPayload: actual.parseUptoPayload,
  };
});

const PAY_TO = "0x207C6D8f63Bf01F70dc6D372693E8D5943848E88";
const PAYER = "0x00000000000000000000000000000000000Da1d0";
const FACILITATOR = "0x9999999999999999999999999999999999999999" as const;

/**
 * A minimal x402 v2 client written from the SPECIFICATION, not from this
 * codebase. It knows one price field — `amount` — and it deletes every other
 * key from the offer before using it, so the test cannot accidentally pass by
 * reading `maxAmount` through some other path.
 *
 * This is the test behind the published claim that any x402 client can pay us.
 * Asserting that we emit what we believe the spec says would only prove we are
 * self-consistent.
 */
async function specClient(url: string, fetchImpl: typeof fetch): Promise<Response> {
  const first = await fetchImpl(url, { method: "POST" });
  if (first.status !== 402) return first;

  const offer = (await first.json()) as {
    x402Version: number;
    accepts: Array<Record<string, unknown>>;
  };

  const spec = offer.accepts[0];
  const price = spec.amount;
  if (typeof price !== "string") {
    throw new Error("offer has no `amount` — a spec client cannot pay this");
  }

  // Sign for exactly what the spec field says, using only spec-named fields.
  const authorization = {
    signature: "0xdeadbeef",
    permit2Authorization: {
      from: PAYER,
      permitted: { token: spec.asset, amount: price },
      spender: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
      nonce: "1",
      deadline: String(Math.floor(Date.now() / 1000) + Number(spec.maxTimeoutSeconds)),
      witness: { to: spec.payTo, facilitator: FACILITATOR, validAfter: "0" },
    },
  };

  return fetchImpl(url, {
    method: "POST",
    headers: {
      "PAYMENT-SIGNATURE": btoa(
        JSON.stringify({
          x402Version: offer.x402Version,
          resource: { url },
          accepted: spec,
          payload: authorization,
        }),
      ),
    },
  });
}

describe("a client that reads only the spec's `amount` can pay us", () => {
  it("completes the flow against an offer built by our middleware", async () => {
    const routes: UptoRoutesConfig = {
      "POST /v1/chat/completions": {
        network: "eip155:8453",
        maxPrice: "$0.01",
        payTo: PAY_TO,
        meter: async () => "5000",
      },
    };

    // The verifier sees exactly what the client signed for.
    let authorizedAmount: string | undefined;
    const verifyFn: VerifyFn = vi.fn(async (payload) => {
      authorizedAmount = payload.permit2Authorization.permitted.amount;
      return { isValid: true, payer: PAYER };
    });
    const settleFn: SettleFn = vi.fn(async (_p, _r, amount) => ({
      success: true,
      transaction: "0xtx",
      network: "eip155:8453",
      settledAmount: amount,
    }));

    const app = new Hono();
    app.use("*", buildUptoMiddleware(routes, verifyFn, settleFn, FACILITATOR));
    app.post("/v1/chat/completions", (c) => c.json({ result: "ok" }));

    const url = "http://localhost/v1/chat/completions";
    const res = await specClient(url, (input, init) =>
      app.request(String(input), init as RequestInit),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "ok" });

    // The client authorized the quoted price, read from `amount` alone…
    expect(authorizedAmount).toBe("10000");
    // …and was charged the metered amount, below the quote.
    expect(res.headers.get("X-Payment-Settled")).toBe("5000");
  });

  it("would fail if the offer stopped carrying `amount`", async () => {
    // Guard against the mirror being emitted in place of the spec field: the
    // spec client throws rather than silently paying an unknown price.
    const offerWithoutAmount = {
      x402Version: 2,
      accepts: [{ maxAmount: "10000", asset: "0x0", payTo: PAY_TO, maxTimeoutSeconds: 300 }],
    };
    const fetchImpl = (async () =>
      new Response(JSON.stringify(offerWithoutAmount), { status: 402 })) as typeof fetch;

    await expect(specClient("http://localhost/x", fetchImpl)).rejects.toThrow(/no `amount`/);
  });
});
