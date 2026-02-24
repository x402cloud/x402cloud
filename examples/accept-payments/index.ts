/**
 * Server-side example: accept x402 micropayments on a Hono API.
 *
 * Uses remoteUptoPaymentMiddleware so the server needs no private keys —
 * payment verification and settlement are delegated to a remote facilitator.
 */
import { Hono } from "hono";
import { remoteUptoPaymentMiddleware } from "@x402cloud/middleware";

const app = new Hono();

// Define paid routes — each path maps to pricing config
const paidRoutes = {
  "/api/premium": {
    network: "eip155:8453" as const,
    maxPrice: "$0.01",
    payTo: "0xYOUR_WALLET_ADDRESS",
    description: "Premium API endpoint",
    meter: () => "$0.001", // flat rate per request
  },
  "/api/generate": {
    network: "eip155:8453" as const,
    maxPrice: "$0.10",
    payTo: "0xYOUR_WALLET_ADDRESS",
    description: "AI generation endpoint",
    meter: (ctx) => {
      // Meter based on response size — charge per KB
      const contentLength = Number(ctx.response.headers.get("content-length") ?? 0);
      const kb = Math.ceil(contentLength / 1024);
      return `$${(kb * 0.001).toFixed(6)}`;
    },
  },
};

// Apply x402 payment middleware (delegates to remote facilitator)
app.use("/*", remoteUptoPaymentMiddleware(paidRoutes, "https://facilitator.x402cloud.ai"));

// Free endpoint — no payment required (not in paidRoutes)
app.get("/api/health", (c) => c.json({ status: "ok" }));

// Paid endpoints
app.get("/api/premium", (c) => c.json({ data: "premium content" }));

app.post("/api/generate", async (c) => {
  const body = await c.req.json();
  return c.json({ result: `Generated from: ${body.prompt}` });
});

export default app;
