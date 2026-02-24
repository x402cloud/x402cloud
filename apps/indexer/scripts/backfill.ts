import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { KNOWN_FACILITATORS, FACILITATOR_NAMES, NETWORKS, EXACT_PROXY, UPTO_PROXY, USDC_TRANSFER_TOPIC } from "../src/constants.js";
import type { SettlementRecord, NetworkConfig } from "../src/types.js";

// ── Config ──────────────────────────────────────────────────────────

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.R2_BUCKET ?? "x402-analytics";

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY) {
  console.error("Required env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY");
  process.exit(1);
}

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT ?? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY,
    secretAccessKey: R2_SECRET_KEY,
  },
});

const DELAY_MS = 150;

// ── Helpers ─────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rpcCall(rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });

  if (res.status === 429) {
    console.log("    Rate limited, waiting 5s...");
    await sleep(5000);
    return rpcCall(rpcUrl, method, params);
  }

  const text = await res.text();
  let json: { result?: unknown; error?: { message: string } };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response: ${text.slice(0, 200)}`);
  }

  if (json.error) throw new Error(`RPC error: ${json.error.message}`);
  return json.result;
}

type AlchemyTransfer = {
  blockNum: string;
  hash: string;
  from: string;
  to: string;
  value: number;
  asset: string;
  category: string;
  rawContract: { address: string; value: string; decimal: string };
  metadata: { blockTimestamp: string };
};

type AlchemyResponse = {
  result?: {
    transfers: AlchemyTransfer[];
    pageKey?: string;
  };
  error?: { message: string; code?: number };
};

type LogEntry = {
  address: string;
  topics: string[];
  data: string;
  transactionHash: string;
  blockNumber: string;
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
  logs: LogEntry[];
};

function writeToR2(records: SettlementRecord[]): Promise<void> {
  if (records.length === 0) return Promise.resolve();
  // Group by month
  const groups = new Map<string, SettlementRecord[]>();
  for (const record of records) {
    const month = new Date(record.timestamp * 1000).toISOString().slice(0, 7);
    const key = `network=${record.network}/month=${month}`;
    const existing = groups.get(key) ?? [];
    existing.push(record);
    groups.set(key, existing);
  }
  const promises: Promise<void>[] = [];
  for (const [partition, partRecords] of groups) {
    const ndjson = partRecords.map((r) => JSON.stringify(r)).join("\n") + "\n";
    const batchId = Date.now();
    promises.push(
      s3.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: `settlements/${partition}-batch-${batchId}.json`,
          Body: ndjson,
          ContentType: "application/x-ndjson",
        }),
      ).then(() => {}),
    );
  }
  return Promise.all(promises).then(() => {});
}

// ── Strategy 1: Proxy-based backfill ─────────────────────────────
// Find all transactions TO the exact/upto proxy by using
// alchemy_getAssetTransfers with category "external" — catches
// contract calls with 0 ETH value.
// Then fetch each receipt to get the USDC Transfer events.

async function fetchProxyTxs(
  rpcUrl: string,
  proxyAddr: string,
  fromBlock: string,
  toBlock: string,
  pageKey?: string,
): Promise<{ transfers: AlchemyTransfer[]; nextPageKey?: string }> {
  const params: Record<string, unknown> = {
    fromBlock,
    toBlock,
    toAddress: proxyAddr,
    category: ["external"],
    withMetadata: true,
    maxCount: "0x3e8",
  };
  if (pageKey) params.pageKey = pageKey;

  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "alchemy_getAssetTransfers",
      params: [params],
      id: 1,
    }),
  });

  if (res.status === 429) {
    await sleep(5000);
    return fetchProxyTxs(rpcUrl, proxyAddr, fromBlock, toBlock, pageKey);
  }

  const text = await res.text();
  let json: AlchemyResponse;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON: ${text.slice(0, 100)}`);
  }

  if (json.error) throw new Error(`Alchemy error: ${json.error.message}`);

  return {
    transfers: json.result?.transfers ?? [],
    nextPageKey: json.result?.pageKey,
  };
}

async function backfillProxySettlements(
  rpcUrl: string,
  proxyAddr: string,
  proxyName: string,
  network: string,
  usdcAddress: string,
): Promise<SettlementRecord[]> {
  console.log(`\n  Scanning ${proxyName} proxy (${proxyAddr.slice(0, 10)}...)`);

  const allTxHashes: { hash: string; timestamp: number; blockNumber: number; from: string }[] = [];
  let pageKey: string | undefined;
  let page = 0;

  // Get all transactions TO the proxy
  do {
    const { transfers, nextPageKey } = await fetchProxyTxs(
      rpcUrl, proxyAddr, "0x0", "latest", pageKey,
    );

    if (transfers.length === 0) break;

    for (const t of transfers) {
      const ts = t.metadata?.blockTimestamp
        ? Math.floor(new Date(t.metadata.blockTimestamp).getTime() / 1000)
        : 0;
      allTxHashes.push({
        hash: t.hash,
        timestamp: ts,
        blockNumber: parseInt(t.blockNum, 16),
        from: t.from,
      });
    }

    page++;
    console.log(`    Page ${page}: ${transfers.length} txs (total: ${allTxHashes.length})`);
    pageKey = nextPageKey;
    await sleep(DELAY_MS);
  } while (pageKey);

  if (allTxHashes.length === 0) {
    console.log(`    No transactions found`);
    return [];
  }

  console.log(`    Found ${allTxHashes.length} proxy calls, fetching receipts...`);

  // For each tx, get receipt and extract USDC Transfer events
  const records: SettlementRecord[] = [];
  const scheme = proxyAddr === EXACT_PROXY ? "exact" : "upto";
  const usdcLower = usdcAddress.toLowerCase();

  for (let i = 0; i < allTxHashes.length; i++) {
    const txInfo = allTxHashes[i];
    try {
      const receipt = (await rpcCall(rpcUrl, "eth_getTransactionReceipt", [txInfo.hash])) as ReceiptInfo | null;
      if (!receipt || receipt.status !== "0x1") continue;

      // Find USDC Transfer events in the receipt
      const transferLogs = receipt.logs.filter(
        (l) =>
          l.address.toLowerCase() === usdcLower &&
          l.topics[0] === USDC_TRANSFER_TOPIC &&
          l.topics.length >= 3,
      );

      const facilitatorName = FACILITATOR_NAMES[txInfo.from.toLowerCase()] ?? "unknown";

      for (const log of transferLogs) {
        const payer = "0x" + log.topics[1].slice(26);
        const payee = "0x" + log.topics[2].slice(26);
        const amount = BigInt(log.data).toString();
        const amountUsd = Number(BigInt(log.data)) / 1e6;

        records.push({
          txHash: txInfo.hash,
          blockNumber: txInfo.blockNumber,
          timestamp: txInfo.timestamp,
          network,
          scheme,
          facilitator: txInfo.from,
          facilitatorName,
          payer,
          payee,
          amount,
          amountUsd,
          token: usdcAddress,
          gasUsed: BigInt(receipt.gasUsed).toString(),
          gasPrice: "0",
        });
      }
    } catch (err) {
      console.error(`    Receipt error for ${txInfo.hash}: ${(err as Error).message}`);
    }

    if ((i + 1) % 100 === 0) {
      console.log(`    ... ${i + 1}/${allTxHashes.length} receipts, ${records.length} settlements`);
      await sleep(DELAY_MS);
    }
  }

  console.log(`    ${proxyName}: ${records.length} settlements from ${allTxHashes.length} txs`);
  return records;
}

// ── Strategy 2: Facilitator-based (for non-proxy settlements) ────
// Some facilitators call USDC directly (transferWithAuthorization).
// Keep the alchemy_getAssetTransfers approach for these.

async function fetchFacilitatorTransfers(
  rpcUrl: string,
  facilitatorAddr: string,
  usdcAddress: string,
  pageKey?: string,
): Promise<{ transfers: AlchemyTransfer[]; nextPageKey?: string }> {
  const params: Record<string, unknown> = {
    fromBlock: "0x0",
    toBlock: "latest",
    fromAddress: facilitatorAddr,
    contractAddresses: [usdcAddress],
    category: ["erc20"],
    withMetadata: true,
    maxCount: "0x3e8",
  };
  if (pageKey) params.pageKey = pageKey;

  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "alchemy_getAssetTransfers",
      params: [params],
      id: 1,
    }),
  });

  if (res.status === 429) {
    await sleep(5000);
    return fetchFacilitatorTransfers(rpcUrl, facilitatorAddr, usdcAddress, pageKey);
  }

  const json: AlchemyResponse = await res.json() as AlchemyResponse;
  if (json.error) throw new Error(`Alchemy error: ${json.error.message}`);

  return {
    transfers: json.result?.transfers ?? [],
    nextPageKey: json.result?.pageKey,
  };
}

async function backfillFacilitatorDirect(
  rpcUrl: string,
  network: string,
  usdcAddress: string,
  proxyTxHashes: Set<string>,
): Promise<SettlementRecord[]> {
  console.log(`\n  Scanning facilitator direct transfers (non-proxy)...`);

  const records: SettlementRecord[] = [];
  const seen = new Set<string>();

  for (const addr of KNOWN_FACILITATORS) {
    if (seen.has(addr)) continue;
    seen.add(addr);

    const name = FACILITATOR_NAMES[addr] ?? addr.slice(0, 10);
    let pageKey: string | undefined;
    let facilTotal = 0;

    do {
      const { transfers, nextPageKey } = await fetchFacilitatorTransfers(
        rpcUrl, addr, usdcAddress, pageKey,
      );

      if (transfers.length === 0) break;

      for (const t of transfers) {
        // Skip if already captured via proxy scan
        if (proxyTxHashes.has(t.hash)) continue;

        const timestamp = t.metadata?.blockTimestamp
          ? Math.floor(new Date(t.metadata.blockTimestamp).getTime() / 1000)
          : 0;

        // For facilitator direct transfers, the facilitator IS the from address
        // This is for cases where facilitator transfers USDC directly (payouts, etc.)
        // The real payer info comes from the receipt — but for Alchemy transfers,
        // we need to fetch the receipt to get the real Transfer event
        const receipt = (await rpcCall(rpcUrl, "eth_getTransactionReceipt", [t.hash])) as ReceiptInfo | null;
        if (!receipt || receipt.status !== "0x1") continue;

        const transferLogs = receipt.logs.filter(
          (l) =>
            l.address.toLowerCase() === usdcAddress.toLowerCase() &&
            l.topics[0] === USDC_TRANSFER_TOPIC &&
            l.topics.length >= 3,
        );

        for (const log of transferLogs) {
          const payer = "0x" + log.topics[1].slice(26);
          const payee = "0x" + log.topics[2].slice(26);
          const amount = BigInt(log.data).toString();
          const amountUsd = Number(BigInt(log.data)) / 1e6;

          records.push({
            txHash: t.hash,
            blockNumber: parseInt(t.blockNum, 16),
            timestamp,
            network,
            scheme: "exact",
            facilitator: addr,
            facilitatorName: name,
            payer,
            payee,
            amount,
            amountUsd,
            token: usdcAddress,
            gasUsed: receipt ? BigInt(receipt.gasUsed).toString() : "0",
            gasPrice: "0",
          });
        }

        facilTotal += transferLogs.length;
      }

      pageKey = nextPageKey;
      await sleep(DELAY_MS);
    } while (pageKey);

    if (facilTotal > 0) {
      console.log(`    [${name}] ${facilTotal} direct transfers`);
    }
  }

  console.log(`    Total direct facilitator transfers: ${records.length}`);
  return records;
}

// ── Main backfill ────────────────────────────────────────────────────

async function backfillNetwork(networkKey: string): Promise<void> {
  const config = NETWORKS[networkKey];
  if (!config) return;

  const envKey = `${networkKey.replace("-", "_").toUpperCase()}_RPC_URL`;
  const rpcUrl = process.env[envKey] ?? process.env.RPC_URL ?? config.rpc;

  const isAlchemy = rpcUrl.includes("alchemy.com");
  if (!isAlchemy) {
    console.log(`[${config.name}] Skipping — requires Alchemy RPC`);
    console.log(`  Set ${envKey} to an Alchemy endpoint`);
    return;
  }

  console.log(`\n[${config.name}] Starting backfill`);

  // Phase 1: Proxy-based settlements (exact + upto)
  const exactRecords = await backfillProxySettlements(
    rpcUrl, EXACT_PROXY, "Exact", config.name, config.usdc,
  );
  const uptoRecords = await backfillProxySettlements(
    rpcUrl, UPTO_PROXY, "Upto", config.name, config.usdc,
  );

  const proxyTxHashes = new Set<string>();
  for (const r of [...exactRecords, ...uptoRecords]) proxyTxHashes.add(r.txHash);

  // Phase 2: Direct facilitator transfers (non-proxy)
  const directRecords = await backfillFacilitatorDirect(
    rpcUrl, config.name, config.usdc, proxyTxHashes,
  );

  // Combine and write
  const allRecords = [...exactRecords, ...uptoRecords, ...directRecords];
  console.log(`\n  Writing ${allRecords.length} total settlements to R2...`);
  await writeToR2(allRecords);

  console.log(`\n[${config.name}] Backfill complete.`);
  console.log(`  Exact proxy: ${exactRecords.length}`);
  console.log(`  Upto proxy:  ${uptoRecords.length}`);
  console.log(`  Direct:      ${directRecords.length}`);
  console.log(`  Total:       ${allRecords.length}`);
}

async function backfill(): Promise<void> {
  for (const networkKey of Object.keys(NETWORKS)) {
    await backfillNetwork(networkKey);
  }
}

backfill().catch(console.error);
