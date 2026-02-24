import type { SettlementRecord } from "./types.js";

/**
 * Group records by network and date for hive-style partitioning.
 * Returns a map of partition key to records.
 */
function partitionRecords(records: SettlementRecord[]): Map<string, SettlementRecord[]> {
  const groups = new Map<string, SettlementRecord[]>();

  for (const record of records) {
    const date = new Date(record.timestamp * 1000).toISOString().slice(0, 10);
    const key = `network=${record.network}/date=${date}`;
    const existing = groups.get(key) ?? [];
    existing.push(record);
    groups.set(key, existing);
  }

  return groups;
}

/** Convert records to NDJSON format. */
function toNdjson(records: SettlementRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

/**
 * Write settlement records to R2 as NDJSON files with hive partitioning.
 *
 * Files are written to: settlements/network={name}/date={YYYY-MM-DD}/batch-{timestamp}.json
 * DuckDB reads NDJSON natively via read_json.
 */
export async function writeRecords(
  r2: R2Bucket,
  records: SettlementRecord[],
): Promise<number> {
  if (records.length === 0) return 0;

  const groups = partitionRecords(records);
  let written = 0;

  for (const [partition, partRecords] of groups) {
    const ndjson = toNdjson(partRecords);
    const batchId = Date.now();
    const key = `settlements/${partition}/batch-${batchId}.json`;

    await r2.put(key, ndjson, {
      httpMetadata: { contentType: "application/x-ndjson" },
    });

    written += partRecords.length;
  }

  return written;
}
