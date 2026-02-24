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

/**
 * Send a batch of JSON-RPC requests in a single HTTP call.
 * Returns results in the same order as the input requests.
 * Throws if the HTTP request fails or if any individual RPC call returns an error.
 */
export async function rpcBatch(
  rpcUrl: string,
  requests: Array<{ method: string; params: unknown[] }>,
): Promise<unknown[]> {
  if (requests.length === 0) return [];

  const body = requests.map((req, i) => ({
    jsonrpc: "2.0" as const,
    method: req.method,
    params: req.params,
    id: i + 1,
  }));

  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (res.status === 429 || res.status === 503) {
    throw new Error(`RPC rate limited (${res.status})`);
  }

  const text = await res.text();
  let json: Array<RpcResponse & { id: number }>;
  try {
    json = JSON.parse(text) as Array<RpcResponse & { id: number }>;
  } catch {
    throw new Error(`RPC batch non-JSON response: ${text.slice(0, 200)}`);
  }

  if (!Array.isArray(json)) {
    throw new Error(`RPC batch expected array response, got: ${text.slice(0, 200)}`);
  }

  // Sort by id to match input order
  json.sort((a, b) => a.id - b.id);

  return json.map((item, i) => {
    if (item.error) {
      throw new Error(`RPC batch error (${requests[i].method}): ${item.error.message}`);
    }
    return item.result;
  });
}

/** Get the latest block number from the chain. */
export async function getBlockNumber(rpcUrl: string): Promise<number> {
  const result = (await rpcCall(rpcUrl, "eth_blockNumber", [])) as string;
  return parseInt(result, 16);
}
