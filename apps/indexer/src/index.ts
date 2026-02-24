import { scanBlocksViaLogs } from "./scan-logs.js";
import { writeRecords } from "./write.js";
import { getBlockNumber } from "./rpc.js";
import { NETWORKS } from "./constants.js";

type Env = {
  ANALYTICS: R2Bucket;
  CURSOR: KVNamespace;
  BASE_RPC_URL?: string;
  BASE_SEPOLIA_RPC_URL?: string;
};

/** Max blocks to process per cron run per network (stays within CPU limits). */
const MAX_BLOCKS_PER_RUN = 5000;

/** Finality buffer: skip the most recent block to avoid reorgs. */
const FINALITY_BUFFER = 1;

function getRpcUrl(env: Env, networkKey: string, defaultRpc: string): string {
  if (networkKey === "base" && env.BASE_RPC_URL) return env.BASE_RPC_URL;
  if (networkKey === "base-sepolia" && env.BASE_SEPOLIA_RPC_URL) return env.BASE_SEPOLIA_RPC_URL;
  return defaultRpc;
}

async function indexNetwork(env: Env, networkKey: string): Promise<void> {
  const config = NETWORKS[networkKey];
  if (!config) return;

  const rpcUrl = getRpcUrl(env, networkKey, config.rpc);
  const cursorKey = `cursor:${networkKey}`;
  const storedCursor = await env.CURSOR.get(cursorKey);
  const lastBlock = storedCursor ? parseInt(storedCursor, 10) : config.startBlock;

  const currentBlock = await getBlockNumber(rpcUrl);
  const fromBlock = lastBlock + 1;
  const toBlock = Math.min(currentBlock - FINALITY_BUFFER, fromBlock + MAX_BLOCKS_PER_RUN - 1);

  if (fromBlock > toBlock) return;

  const records = await scanBlocksViaLogs(rpcUrl, fromBlock, toBlock, config.name, config.usdc);

  if (records.length > 0) {
    await writeRecords(env.ANALYTICS, records);
  }

  await env.CURSOR.put(cursorKey, String(toBlock));
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const tasks = Object.keys(NETWORKS).map((networkKey) => indexNetwork(env, networkKey));
    ctx.waitUntil(Promise.all(tasks));
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ status: "ok" });
    }

    if (url.pathname === "/trigger") {
      await this.scheduled({} as ScheduledEvent, env, ctx);
      return Response.json({ status: "triggered" });
    }

    if (url.pathname === "/cursor") {
      const cursors: Record<string, string | null> = {};
      for (const networkKey of Object.keys(NETWORKS)) {
        cursors[networkKey] = await env.CURSOR.get(`cursor:${networkKey}`);
      }
      return Response.json(cursors);
    }

    return new Response("x402 indexer", { status: 200 });
  },
};
