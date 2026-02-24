import type { RpcBlock, RpcReceipt, SettlementRecord } from "./types.js";
import { PROXY_ADDRESSES } from "./constants.js";
import { rpcCall } from "./rpc.js";
import { parseSettlement } from "./parse.js";

/**
 * Check if a transaction targets one of the x402 proxy contracts.
 */
function isProxyTransaction(to: string | null): boolean {
  return to !== null && PROXY_ADDRESSES.includes(to.toLowerCase());
}

/**
 * Scan a range of blocks for x402 settlement transactions.
 *
 * For each block, fetches full transaction objects, filters for those
 * targeting proxy addresses, then fetches receipts and parses USDC
 * Transfer events.
 */
export async function scanBlocks(
  rpcUrl: string,
  fromBlock: number,
  toBlock: number,
  network: string,
  usdcAddress: string,
): Promise<SettlementRecord[]> {
  const records: SettlementRecord[] = [];

  for (let blockNum = fromBlock; blockNum <= toBlock; blockNum++) {
    const block = (await rpcCall(rpcUrl, "eth_getBlockByNumber", [
      `0x${blockNum.toString(16)}`,
      true,
    ])) as RpcBlock | null;

    if (!block || !block.transactions) continue;

    const timestamp = parseInt(block.timestamp, 16);
    const proxyTxs = block.transactions.filter((tx) => isProxyTransaction(tx.to));

    for (const tx of proxyTxs) {
      const receipt = (await rpcCall(rpcUrl, "eth_getTransactionReceipt", [
        tx.hash,
      ])) as RpcReceipt | null;

      if (!receipt) continue;

      const parsed = parseSettlement(tx, receipt, blockNum, timestamp, network, usdcAddress);
      records.push(...parsed);
    }
  }

  return records;
}
