import type { SettlementRecord } from "./types.js";
import {
  PROXY_ADDRESSES,
  KNOWN_FACILITATORS,
  FACILITATOR_NAMES,
  USDC_TRANSFER_TOPIC,
  EXACT_PROXY,
  UPTO_PROXY,
} from "./constants.js";
import { rpcCall } from "./rpc.js";

type LogEntry = {
  address: string;
  topics: string[];
  data: string;
  transactionHash: string;
  blockNumber: string;
  logIndex: string;
};

type TxInfo = {
  from: string;
  to: string | null;
  hash: string;
  gasPrice: string;
};

type ReceiptInfo = {
  status: string;
  gasUsed: string;
};

function resolveScheme(tx: TxInfo): string {
  if (!tx.to) return "unknown";
  const lower = tx.to.toLowerCase();
  if (lower === UPTO_PROXY) return "upto";
  if (lower === EXACT_PROXY) return "exact";
  // If tx.to is USDC (EIP-3009 transferWithAuthorization), it's exact scheme
  return "exact";
}

/**
 * Determine if a transaction is an x402 settlement:
 * 1. Transaction TO a proxy address (Permit2-based upto/exact)
 * 2. Transaction FROM a known facilitator TO the USDC contract (EIP-3009 exact)
 */
function isX402Settlement(tx: TxInfo, usdcAddress: string): boolean {
  if (!tx.to) return false;
  const to = tx.to.toLowerCase();
  const from = tx.from.toLowerCase();

  // Permit2-based: tx targets a proxy contract
  if (PROXY_ADDRESSES.includes(to)) return true;

  // EIP-3009: known facilitator calls USDC directly (transferWithAuthorization)
  if (to === usdcAddress.toLowerCase() && KNOWN_FACILITATORS.includes(from)) return true;

  return false;
}

/**
 * Scan a range of blocks using eth_getLogs to find USDC Transfer events,
 * then filter for x402 settlements (proxy txs OR facilitator-initiated transfers).
 */
export async function scanBlocksViaLogs(
  rpcUrl: string,
  fromBlock: number,
  toBlock: number,
  network: string,
  usdcAddress: string,
): Promise<SettlementRecord[]> {
  // Query USDC Transfer events in the block range
  const logs = (await rpcCall(rpcUrl, "eth_getLogs", [
    {
      address: usdcAddress,
      topics: [USDC_TRANSFER_TOPIC],
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: `0x${toBlock.toString(16)}`,
    },
  ])) as LogEntry[];

  if (!logs || logs.length === 0) return [];

  // Deduplicate by txHash
  const uniqueTxHashes = [...new Set(logs.map((l) => l.transactionHash))];

  const records: SettlementRecord[] = [];
  const blockTimestamps = new Map<string, number>();

  for (const txHash of uniqueTxHashes) {
    const tx = (await rpcCall(rpcUrl, "eth_getTransactionByHash", [txHash])) as TxInfo | null;
    if (!tx) continue;

    // Check if this is an x402 settlement
    if (!isX402Settlement(tx, usdcAddress)) continue;

    // Fetch receipt for gas info and status
    const receipt = (await rpcCall(rpcUrl, "eth_getTransactionReceipt", [txHash])) as ReceiptInfo | null;
    if (!receipt || receipt.status !== "0x1") continue;

    // Get Transfer logs for this tx
    const txLogs = logs.filter((l) => l.transactionHash === txHash && l.topics.length >= 3);
    if (txLogs.length === 0) continue;

    const blockHex = txLogs[0].blockNumber;
    const blockNumber = parseInt(blockHex, 16);

    // Cache block timestamps
    if (!blockTimestamps.has(blockHex)) {
      const block = (await rpcCall(rpcUrl, "eth_getBlockByNumber", [blockHex, false])) as {
        timestamp: string;
      } | null;
      blockTimestamps.set(blockHex, block ? parseInt(block.timestamp, 16) : 0);
    }
    const timestamp = blockTimestamps.get(blockHex) ?? 0;

    const scheme = resolveScheme(tx);
    const facilitatorName = FACILITATOR_NAMES[tx.from.toLowerCase()] ?? "unknown";

    for (const log of txLogs) {
      const payer = "0x" + log.topics[1].slice(26);
      const payee = "0x" + log.topics[2].slice(26);
      const amount = BigInt(log.data).toString();
      const amountUsd = Number(BigInt(log.data)) / 1e6;

      records.push({
        txHash,
        blockNumber,
        timestamp,
        network,
        scheme,
        facilitator: tx.from,
        facilitatorName,
        payer,
        payee,
        amount,
        amountUsd,
        token: usdcAddress,
        gasUsed: BigInt(receipt.gasUsed).toString(),
        gasPrice: BigInt(tx.gasPrice).toString(),
      });
    }
  }

  return records;
}
