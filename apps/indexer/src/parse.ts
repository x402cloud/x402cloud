import type { RpcLog, RpcReceipt, RpcTransaction, SettlementRecord } from "./types.js";
import { EXACT_PROXY, UPTO_PROXY, USDC_TRANSFER_TOPIC, FACILITATOR_NAMES } from "./constants.js";

/**
 * Extract USDC Transfer logs from a transaction receipt.
 * Only returns logs emitted by the given USDC contract address.
 */
function findUsdcTransfers(receipt: RpcReceipt, usdcAddress: string): RpcLog[] {
  return receipt.logs.filter(
    (log) =>
      log.address.toLowerCase() === usdcAddress.toLowerCase() &&
      log.topics[0] === USDC_TRANSFER_TOPIC &&
      log.topics.length >= 3,
  );
}

/** Determine the scheme based on which proxy address was called. */
function resolveScheme(toAddress: string): string {
  if (toAddress.toLowerCase() === UPTO_PROXY) return "upto";
  if (toAddress.toLowerCase() === EXACT_PROXY) return "exact";
  return "unknown";
}

/**
 * Parse a settlement transaction and its receipt into SettlementRecords.
 * A single transaction may produce multiple Transfer events (rare but possible),
 * so this returns an array.
 */
export function parseSettlement(
  tx: RpcTransaction,
  receipt: RpcReceipt,
  blockNumber: number,
  timestamp: number,
  network: string,
  usdcAddress: string,
): SettlementRecord[] {
  if (receipt.status !== "0x1") return [];

  const transferLogs = findUsdcTransfers(receipt, usdcAddress);
  const scheme = resolveScheme(tx.to!);

  return transferLogs.map((log) => {
    const payer = "0x" + log.topics[1].slice(26);
    const payee = "0x" + log.topics[2].slice(26);
    const amount = BigInt(log.data).toString();
    const amountUsd = Number(BigInt(log.data)) / 1e6;

    return {
      txHash: tx.hash,
      blockNumber,
      timestamp,
      network,
      scheme,
      facilitator: tx.from,
      facilitatorName: FACILITATOR_NAMES[tx.from.toLowerCase()] ?? "unknown",
      payer,
      payee,
      amount,
      amountUsd,
      token: usdcAddress,
      gasUsed: BigInt(receipt.gasUsed).toString(),
      gasPrice: BigInt(tx.gasPrice).toString(),
    };
  });
}
