import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";

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

async function listAllKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function getContent(key: string): Promise<string> {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return (await res.Body?.transformToString()) ?? "";
}

async function compact(): Promise<void> {
  const allKeys = await listAllKeys("settlements/");
  console.log(`Found ${allKeys.length} files in R2`);

  // Group by month: settlements/network=base/date=2025-10-15/batch-xxx.json → 2025-10
  const monthGroups = new Map<string, string[]>();
  for (const key of allKeys) {
    const dateMatch = key.match(/date=(\d{4}-\d{2})/);
    const netMatch = key.match(/network=([^/]+)/);
    if (!dateMatch || !netMatch) continue;
    const monthKey = `${netMatch[1]}/${dateMatch[1]}`;
    const existing = monthGroups.get(monthKey) ?? [];
    existing.push(key);
    monthGroups.set(monthKey, existing);
  }

  let totalWritten = 0;
  let totalDeleted = 0;

  for (const [monthKey, keys] of monthGroups) {
    if (keys.length <= 1) continue; // already compact

    const [network, month] = monthKey.split("/");
    console.log(`\nCompacting ${network}/${month}: ${keys.length} files`);

    // Collect all records, deduplicate by txHash
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const key of keys) {
      const content = await getContent(key);
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const rec = JSON.parse(line);
          if (rec.txHash && !seen.has(rec.txHash)) {
            seen.add(rec.txHash);
            lines.push(line);
          }
        } catch {
          // skip malformed
        }
      }
    }

    if (lines.length === 0) continue;

    // Write compacted file
    const compactKey = `settlements/network=${network}/month=${month}.json`;
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: compactKey,
        Body: lines.join("\n") + "\n",
        ContentType: "application/x-ndjson",
      }),
    );
    console.log(`  Wrote ${compactKey} (${lines.length} records)`);
    totalWritten += lines.length;

    // Delete old files (excluding the new compact file)
    const toDelete = keys.filter((k) => k !== compactKey);
    if (toDelete.length > 0) {
      // S3 DeleteObjects accepts max 1000 per call
      for (let i = 0; i < toDelete.length; i += 1000) {
        const batch = toDelete.slice(i, i + 1000);
        await s3.send(
          new DeleteObjectsCommand({
            Bucket: BUCKET,
            Delete: { Objects: batch.map((Key) => ({ Key })) },
          }),
        );
      }
      console.log(`  Deleted ${toDelete.length} old files`);
      totalDeleted += toDelete.length;
    }
  }

  console.log(`\nCompaction complete. ${totalWritten} records written, ${totalDeleted} old files removed.`);
  const remaining = await listAllKeys("settlements/");
  console.log(`Files remaining: ${remaining.length}`);
}

compact().catch(console.error);
