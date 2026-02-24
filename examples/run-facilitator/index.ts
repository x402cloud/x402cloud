/**
 * Example: run your own x402 facilitator.
 *
 * The facilitator verifies payment signatures and settles on-chain.
 * It holds a private key to pay gas for settlement transactions.
 */
import { Hono } from "hono";
import { createFacilitator } from "@x402cloud/facilitator";
import { baseSepolia } from "viem/chains";

const facilitator = createFacilitator({
  privateKey: "0xYOUR_FACILITATOR_PRIVATE_KEY",
  rpcUrl: "https://sepolia.base.org",
  network: "eip155:84532",
  chain: baseSepolia,
});

console.log(`Facilitator address: ${facilitator.address}`);

// Expose verify/settle as HTTP endpoints
const app = new Hono();

app.post("/verify", async (c) => {
  const { payload, requirements } = await c.req.json();
  const result = await facilitator.verify(payload, requirements);
  return c.json(result);
});

app.post("/settle", async (c) => {
  const { payload, requirements, settlementAmount } = await c.req.json();
  const result = await facilitator.settle(payload, requirements, settlementAmount);
  return c.json(result);
});

app.get("/health", (c) =>
  c.json({ address: facilitator.address, network: facilitator.network }),
);

export default app;
