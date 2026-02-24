import type { Probe } from "../types.js";

const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

export const permit2Contract: Probe = async (target) => {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(target.rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_getCode",
        params: [PERMIT2_ADDRESS, "latest"],
        id: 1,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const json = (await response.json()) as { result?: string; error?: { message: string } };

    if (json.error) {
      return {
        name: "permit2-contract",
        status: "fail",
        latencyMs: Date.now() - start,
        error: json.error.message,
        meta: { address: PERMIT2_ADDRESS },
      };
    }

    const code = json.result ?? "0x";
    const codeSize = (code.length - 2) / 2;
    const hasCode = code.length > 2;

    return {
      name: "permit2-contract",
      status: hasCode ? "pass" : "fail",
      latencyMs: Date.now() - start,
      error: hasCode ? undefined : "No contract code at Permit2 address",
      meta: { address: PERMIT2_ADDRESS, codeSize },
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return {
      name: "permit2-contract",
      status: "fail",
      latencyMs: Date.now() - start,
      error: message,
      meta: { address: PERMIT2_ADDRESS },
    };
  }
};
