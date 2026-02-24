import type { Probe } from "../types.js";

export const rpcAlive: Probe = async (target) => {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(target.rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_blockNumber",
        params: [],
        id: 1,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const json = (await response.json()) as { result?: string; error?: { message: string } };

    if (json.error) {
      return {
        name: "rpc-alive",
        status: "fail",
        latencyMs: Date.now() - start,
        error: json.error.message,
      };
    }

    return {
      name: "rpc-alive",
      status: "pass",
      latencyMs: Date.now() - start,
      meta: { blockNumber: json.result },
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return {
      name: "rpc-alive",
      status: "fail",
      latencyMs: Date.now() - start,
      error: message,
    };
  }
};
