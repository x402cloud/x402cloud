import type { Probe } from "../types.js";

const USDC_ADDRESSES: Record<string, string> = {
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

const NAME_SELECTOR = "0x06fdde03";

export const usdcContract: Probe = async (target) => {
  const start = Date.now();
  const address = USDC_ADDRESSES[target.network];

  if (!address) {
    return {
      name: "usdc-contract",
      status: "skip",
      latencyMs: Date.now() - start,
      error: `No USDC address for network ${target.network}`,
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(target.rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_call",
        params: [{ to: address, data: NAME_SELECTOR }, "latest"],
        id: 1,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const json = (await response.json()) as { result?: string; error?: { message: string } };

    if (json.error) {
      return {
        name: "usdc-contract",
        status: "fail",
        latencyMs: Date.now() - start,
        error: json.error.message,
        meta: { address, network: target.network },
      };
    }

    return {
      name: "usdc-contract",
      status: "pass",
      latencyMs: Date.now() - start,
      meta: { address, network: target.network },
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return {
      name: "usdc-contract",
      status: "fail",
      latencyMs: Date.now() - start,
      error: message,
      meta: { address, network: target.network },
    };
  }
};
