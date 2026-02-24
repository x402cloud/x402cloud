import { wrapProbe } from "../wrap.js";

const USDC_ADDRESSES: Record<string, string> = {
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

const NAME_SELECTOR = "0x06fdde03";

export const usdcContract = wrapProbe("usdc-contract", async (target, signal) => {
  const address = USDC_ADDRESSES[target.network];

  if (!address) {
    return {
      name: "usdc-contract",
      status: "skip",
      error: `No USDC address for network ${target.network}`,
    };
  }

  const response = await fetch(target.rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_call",
      params: [{ to: address, data: NAME_SELECTOR }, "latest"],
      id: 1,
    }),
    signal,
  });

  const json = (await response.json()) as { result?: string; error?: { message: string } };

  if (json.error) {
    return {
      name: "usdc-contract",
      status: "fail",
      error: json.error.message,
      meta: { address, network: target.network },
    };
  }

  return {
    name: "usdc-contract",
    status: "pass",
    meta: { address, network: target.network },
  };
});
