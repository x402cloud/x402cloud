import { timingSafeEqual } from "crypto";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createFacilitator, createFacilitatorRoutes, type Facilitator } from "@x402cloud/facilitator";
import type { Network } from "@x402cloud/protocol";
import { CHAINS } from "@x402cloud/evm";
import type { Context, Next } from "hono";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const PRIVATE_KEY = process.env.FACILITATOR_PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL;
const NETWORK = process.env.NETWORK ?? "eip155:8453";
const API_TOKEN = process.env.FACILITATOR_API_TOKEN;

if (!PRIVATE_KEY) throw new Error("FACILITATOR_PRIVATE_KEY is required");
if (!RPC_URL) throw new Error("RPC_URL is required");

const chain = CHAINS[NETWORK];
if (!chain) throw new Error(`Unsupported network: ${NETWORK}. Supported: ${Object.keys(CHAINS).join(", ")}`);

const facilitator: Facilitator = createFacilitator({
  privateKey: PRIVATE_KEY as `0x${string}`,
  rpcUrl: RPC_URL,
  network: NETWORK as Network,
  chain,
});

const app = new Hono();

// ── Info ─────────────────────────────────────────────────────────────
app.get("/", (c) => {
  return c.json({
    name: "x402cloud facilitator (self-hosted)",
    description: "x402 protocol facilitator — verify and settle USDC payments on-chain using the x402 standard",
    schemes: ["exact", "upto"],
    network: NETWORK,
    facilitator: facilitator.address,
    endpoints: {
      "/health": { method: "GET", auth: false },
      "/supported": { method: "GET", auth: false },
      "/verify": { method: "POST", auth: !!API_TOKEN, description: "Verify upto payment" },
      "/settle": { method: "POST", auth: !!API_TOKEN, description: "Settle upto payment" },
      "/verify-exact": { method: "POST", auth: !!API_TOKEN, description: "Verify exact payment" },
      "/settle-exact": { method: "POST", auth: !!API_TOKEN, description: "Settle exact payment" },
    },
  });
});

app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/supported", (c) => {
  return c.json({
    schemes: ["exact", "upto"],
    networks: [NETWORK],
    facilitator: facilitator.address,
  });
});

// ── Constant-time string comparison (prevents timing attacks) ────────
function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

// ── Auth middleware (optional — only if API_TOKEN is set) ─────────────
const authMiddleware = async (c: Context, next: Next) => {
  if (API_TOKEN) {
    const auth = c.req.header("Authorization");
    if (!auth || !constantTimeEqual(auth, `Bearer ${API_TOKEN}`)) {
      return c.json({ error: "unauthorized" }, 401);
    }
  }
  await next();
};

app.use("/verify", authMiddleware);
app.use("/settle", authMiddleware);
app.use("/verify-exact", authMiddleware);
app.use("/settle-exact", authMiddleware);

// ── Payment routes (shared) ──────────────────────────────────────────
app.route("/", createFacilitatorRoutes(() => facilitator));

console.log(`x402cloud facilitator listening on :${PORT}`);
console.log(`  network: ${NETWORK}`);
console.log(`  address: ${facilitator.address}`);
console.log(`  auth:    ${API_TOKEN ? "enabled" : "disabled (set FACILITATOR_API_TOKEN to enable)"}`);

serve({ fetch: app.fetch, port: PORT });
