import { wrapProbe } from "../wrap.js";

export const rpcAlive = wrapProbe("rpc-alive", async (target, signal) => {
  const response = await fetch(target.rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_blockNumber",
      params: [],
      id: 1,
    }),
    signal,
  });

  const json = (await response.json()) as { result?: string; error?: { message: string } };

  if (json.error) {
    return {
      name: "rpc-alive",
      status: "fail",
      error: json.error.message,
    };
  }

  return {
    name: "rpc-alive",
    status: "pass",
    meta: { blockNumber: json.result },
  };
});
