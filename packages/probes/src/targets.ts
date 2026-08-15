import type { Target } from "./types.js";

// The operator's wallet: pays gas as the facilitator AND receives settled
// USDC as the `payTo`/`OPERATOR_ADDRESS` recipient on every paid service
// (see docs/MAINNET-RUNBOOK.md §4-6, apps/infer's SERVER_ADDRESS). Public —
// it is already committed in multiple wrangler.toml files and docs.
const OPERATOR_ADDRESS = "0x207C6D8f63Bf01F70dc6D372693E8D5943848E88";

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
    operatorAddress: OPERATOR_ADDRESS,
  },
  // Base mainnet: chain-level probes only (RPC, USDC, Permit2) until the
  // hosted facilitator/infer services launch there — the live services at
  // *.x402cloud.ai currently settle on Base Sepolia (see `testnet` above).
  // Flip facilitator/infer to their URLs as part of the mainnet runbook.
  mainnet: {
    name: "mainnet",
    rpc: "https://mainnet.base.org",
    facilitator: null,
    infer: null,
    network: "eip155:8453",
    operatorAddress: OPERATOR_ADDRESS,
  },
};
