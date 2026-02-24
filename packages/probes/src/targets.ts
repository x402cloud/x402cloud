import type { Target } from "./types.js";

export const TARGETS: Record<string, Target> = {
  local: {
    name: "local",
    rpc: "http://127.0.0.1:8546",
    facilitator: "http://127.0.0.1:3000",
    infer: null,
    network: "eip155:84532",
  },
  testnet: {
    name: "testnet",
    rpc: "https://sepolia.base.org",
    facilitator: "https://facilitator.x402cloud.ai",
    infer: "https://infer.x402cloud.ai",
    network: "eip155:84532",
  },
  production: {
    name: "production",
    rpc: "https://mainnet.base.org",
    facilitator: "https://facilitator.x402cloud.ai",
    infer: "https://infer.x402cloud.ai",
    network: "eip155:8453",
  },
};
