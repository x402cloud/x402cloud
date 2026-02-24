type RpcResponse = {
  result?: unknown;
  error?: { message: string; code?: number };
};

/**
 * Make a JSON-RPC call to an EVM node.
 * Throws on RPC-level errors so callers get a clean result.
 */
export async function rpcCall(rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });

  if (res.status === 429 || res.status === 503) {
    throw new Error(`RPC rate limited (${res.status})`);
  }

  const text = await res.text();
  let json: RpcResponse;
  try {
    json = JSON.parse(text) as RpcResponse;
  } catch {
    throw new Error(`RPC non-JSON response (${method}): ${text.slice(0, 100)}`);
  }

  if (json.error) {
    throw new Error(`RPC error (${method}): ${json.error.message}`);
  }
  return json.result;
}

/** Get the latest block number from the chain. */
export async function getBlockNumber(rpcUrl: string): Promise<number> {
  const result = (await rpcCall(rpcUrl, "eth_blockNumber", [])) as string;
  return parseInt(result, 16);
}
