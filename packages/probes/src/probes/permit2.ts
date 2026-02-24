import { wrapProbe } from "../wrap.js";

const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

export const permit2Contract = wrapProbe("permit2-contract", async (target, signal) => {
  const response = await fetch(target.rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_getCode",
      params: [PERMIT2_ADDRESS, "latest"],
      id: 1,
    }),
    signal,
  });

  const json = (await response.json()) as { result?: string; error?: { message: string } };

  if (json.error) {
    return {
      name: "permit2-contract",
      status: "fail",
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
    error: hasCode ? undefined : "No contract code at Permit2 address",
    meta: { address: PERMIT2_ADDRESS, codeSize },
  };
});
