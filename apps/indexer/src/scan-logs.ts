import type { SettlementRecord, RpcLog, RpcTransaction, RpcReceipt } from "./types.js";
import {
  PROXY_ADDRESSES,
  USDC_TRANSFER_TOPIC,
  EXACT_PROXY,
  UPTO_PROXY,
} from "./constants.js";
import { rpcCall, rpcBatch } from "./rpc.js";

function resolveScheme(tx: RpcTransaction): string {
  if (!tx.to) return "unknown";
  const lower = tx.to.toLowerCase();
  if (lower === UPTO_PROXY) return "upto";
  if (lower === EXACT_PROXY) return "exact";
  // If tx.to is USDC (EIP-3009 transferWithAuthorization), it's exact scheme
  return "exact";
}

/**
 * Determine if a transaction is an x402 settlement:
 * Transaction TO a proxy address (Permit2-based upto/exact).
 */
function isX402Settlement(tx: RpcTransaction): boolean {
  if (!tx.to) return false;
  return PROXY_ADDRESSES.includes(tx.to.toLowerCase());
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
  ])) as RpcLog[];

  if (!logs || logs.length === 0) return [];

  // Deduplicate by txHash
  const uniqueTxHashes = [...new Set(logs.map((l) => l.transactionHash))];

  const BATCH_SIZE = 30;

  // --- Batch 1: Fetch all transactions ---
  const txByHash = new Map<string, RpcTransaction>();
  for (let i = 0; i < uniqueTxHashes.length; i += BATCH_SIZE) {
    const chunk = uniqueTxHashes.slice(i, i + BATCH_SIZE);
    const results = await rpcBatch(
      rpcUrl,
      chunk.map((hash) => ({ method: "eth_getTransactionByHash", params: [hash] })),
    );
    for (let j = 0; j < chunk.length; j++) {
      const tx = results[j] as RpcTransaction | null;
      if (tx && isX402Settlement(tx)) {
        txByHash.set(chunk[j], tx);
      }
    }
  }

  if (txByHash.size === 0) return [];

  // --- Batch 2: Fetch receipts for settlement txs only ---
  const settlementHashes = [...txByHash.keys()];
  const receiptByHash = new Map<string, RpcReceipt>();
  for (let i = 0; i < settlementHashes.length; i += BATCH_SIZE) {
    const chunk = settlementHashes.slice(i, i + BATCH_SIZE);
    const results = await rpcBatch(
      rpcUrl,
      chunk.map((hash) => ({ method: "eth_getTransactionReceipt", params: [hash] })),
    );
    for (let j = 0; j < chunk.length; j++) {
      const receipt = results[j] as RpcReceipt | null;
      if (receipt && receipt.status === "0x1") {
        receiptByHash.set(chunk[j], receipt);
      }
    }
  }

  // --- Collect unique block numbers that need timestamps ---
  const blockTimestamps = new Map<string, number>();
  const neededBlocks = new Set<string>();
  for (const txHash of receiptByHash.keys()) {
    const txLogs = logs.filter((l) => l.transactionHash === txHash && l.topics.length >= 3);
    if (txLogs.length > 0) {
      neededBlocks.add(txLogs[0].blockNumber);
    }
  }

  // --- Batch 3: Fetch block timestamps ---
  const blockArray = [...neededBlocks];
  for (let i = 0; i < blockArray.length; i += BATCH_SIZE) {
    const chunk = blockArray.slice(i, i + BATCH_SIZE);
    const results = await rpcBatch(
      rpcUrl,
      chunk.map((blockHex) => ({ method: "eth_getBlockByNumber", params: [blockHex, false] })),
    );
    for (let j = 0; j < chunk.length; j++) {
      const block = results[j] as { timestamp: string } | null;
      blockTimestamps.set(chunk[j], block ? parseInt(block.timestamp, 16) : 0);
    }
  }

  // --- Build settlement records ---
  const records: SettlementRecord[] = [];
  for (const txHash of receiptByHash.keys()) {
    const tx = txByHash.get(txHash)!;
    const receipt = receiptByHash.get(txHash)!;

    const txLogs = logs.filter((l) => l.transactionHash === txHash && l.topics.length >= 3);
    if (txLogs.length === 0) continue;

    const blockHex = txLogs[0].blockNumber;
    const blockNumber = parseInt(blockHex, 16);
    const timestamp = blockTimestamps.get(blockHex) ?? 0;
    const scheme = resolveScheme(tx);

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
