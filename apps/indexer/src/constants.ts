import type { NetworkConfig } from "./types.js";

// ── x402 Proxy Contracts ────────────────────────────────────────────
// Used by the "upto" and "exact" Permit2-based schemes (testnet mainly)
export const UPTO_PROXY = "0x4020633461b2895a48930Ff97eE8fCdE8E520002".toLowerCase();
export const EXACT_PROXY = "0x4020615294c913F045dc10f0a5cdEbd86c280001".toLowerCase();
export const PROXY_ADDRESSES = [UPTO_PROXY, EXACT_PROXY] as const;

export const USDC_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// TransferWithAuthorization (EIP-3009) event signature
// event TransferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)
export const TRANSFER_WITH_AUTH_TOPIC =
  "0xe3e46ecf1138180bf93cba62a0b7e3aedfb2e61271b549a2688aabfa53c5022a";

export const NETWORKS: Record<string, NetworkConfig> = {
  base: {
    name: "base",
    chainId: 8453,
    rpc: "https://mainnet.base.org",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    // First CDP facilitator tx was May 5, 2025 (~block 29.5M)
    startBlock: 29_000_000,
  },
  "base-sepolia": {
    name: "base-sepolia",
    chainId: 84532,
    rpc: "https://sepolia.base.org",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    startBlock: 22_000_000,
  },
};
