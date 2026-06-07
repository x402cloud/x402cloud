import { base, baseSepolia } from "viem/chains";
import type { Chain } from "viem";

/** Network CAIP-2 ID → viem Chain object */
export const CHAINS: Record<string, Chain> = {
  "eip155:8453": base,
  "eip155:84532": baseSepolia,
};

/** Uniswap Permit2 — canonical address on all EVM chains */
export const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

/**
 * Bounded receipt-wait used by settle/confirm (Finding 2).
 *
 * viem's `waitForTransactionReceipt` defaults to 180_000ms. Left unbounded, an
 * in_flight settle can hold the single-use nonce ~180s+, which can exceed the
 * orchestrator's in_flight lease and let a concurrent attempt reclaim and
 * double-broadcast. We pass this explicit, smaller bound so the worst-case
 * settle wall-clock (sign + send + this) stays comfortably under the lease TTL.
 * The lease (apps/facilitator-api LOCK_TTL_MS) MUST stay strictly larger.
 */
export const SETTLEMENT_RECEIPT_TIMEOUT_MS = 60_000;

/**
 * Coinbase-deployed x402 proxy for exact (fixed) payments.
 *
 * Confirmed live on Base Sepolia (eip155:84532). NOT deployed at this address
 * on Base mainnet (eip155:8453) — `eth_getCode` returns `0x`. See
 * `proxyAddresses()` for the chain-keyed resolution that mainnet needs.
 */
export const X402_EXACT_PROXY = "0x4020615294c913F045dc10f0a5cdEbd86c280001" as const;

/**
 * Coinbase-deployed x402 proxy for upto (metered) payments.
 *
 * Confirmed live on Base Sepolia (eip155:84532). NOT deployed at this address
 * on Base mainnet (eip155:8453) — `eth_getCode` returns `0x`. See
 * `proxyAddresses()` for the chain-keyed resolution that mainnet needs.
 */
export const X402_UPTO_PROXY = "0x4020633461b2895a48930Ff97eE8fCdE8E520002" as const;

/** The two proxy addresses used by a given chain. */
export type ProxyAddresses = {
  /** Spender/verifyingContract for the exact (fixed) scheme. */
  exact: `0x${string}`;
  /** Spender/verifyingContract for the upto (metered) scheme. */
  upto: `0x${string}`;
};

/**
 * Per-chain proxy address overrides, keyed by CAIP-2 network id.
 *
 * Only populate a chain here when its proxies live at addresses that differ
 * from the legacy `X402_*_PROXY` constants. Chains absent from this map fall
 * back to those constants via {@link proxyAddresses} — so Base Sepolia and
 * every existing caller keep their current addresses untouched.
 *
 * Mainnet (`eip155:8453`) is intentionally NOT listed yet: the repo's legacy
 * addresses have no bytecode there, and Coinbase's canonical CREATE2 proxies
 * (exact `0x402085c248EeA27D92E8b30b2C58ed07f9E20001`,
 * upto  `0x4020A4f3b7b90ccA423B9fabCc0CE57C6C240002`) carry *different* bytecode
 * than the Sepolia proxies this package's `settle` ABI was written against.
 * Verify the settle signature on-chain before adding the mainnet entry — see
 * docs/MAINNET-RUNBOOK.md §3a.
 */
export const PROXY_ADDRESSES: Readonly<Record<string, ProxyAddresses>> = Object.freeze({});

/**
 * Resolve the exact/upto proxy addresses for a CAIP-2 network.
 *
 * Falls back to the legacy `X402_*_PROXY` constants for any chain not present
 * in {@link PROXY_ADDRESSES}, so existing single-chain (Sepolia) callers are
 * unaffected. New chains accrete by adding a `PROXY_ADDRESSES` entry — no
 * change to this function or its callers required.
 */
export function proxyAddresses(network: string): ProxyAddresses {
  return (
    PROXY_ADDRESSES[network] ?? {
      exact: X402_EXACT_PROXY,
      upto: X402_UPTO_PROXY,
    }
  );
}

/** Default USDC contract addresses by CAIP-2 network. Consumers merge at construction time. */
export const DEFAULT_USDC_ADDRESSES: Readonly<Record<string, `0x${string}`>> = Object.freeze({
  "eip155:1":      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",  // Ethereum
  "eip155:10":     "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",  // Optimism
  "eip155:137":    "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",  // Polygon
  "eip155:8453":   "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",  // Base
  "eip155:84532":  "0x036CbD53842c5426634e7929541eC2318f3dCF7e",  // Base Sepolia
  "eip155:42161":  "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",  // Arbitrum One
  "eip155:421614": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",  // Arbitrum Sepolia
  "eip155:43114":  "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",  // Avalanche
});

/** EIP-712 domain for Permit2 signatures */
export function permit2Domain(chainId: number) {
  return {
    name: "Permit2",
    chainId,
    verifyingContract: PERMIT2_ADDRESS,
  } as const;
}

/** EIP-712 types for Permit2 with Witness */
export const permit2WitnessTypes = {
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  PermitWitnessTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "witness", type: "Witness" },
  ],
  Witness: [
    { name: "to", type: "address" },
    { name: "validAfter", type: "uint256" },
    { name: "extra", type: "bytes" },
  ],
} as const;

/** ERC-20 ABI subset for balance/allowance checks */
export const erc20Abi = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** x402 Upto Permit2 Proxy ABI — settle function */
export const uptoProxyAbi = [
  {
    name: "settle",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "permit",
        type: "tuple",
        components: [
          {
            name: "permitted",
            type: "tuple",
            components: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint256" },
            ],
          },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { name: "amount", type: "uint256" },
      { name: "owner", type: "address" },
      {
        name: "witness",
        type: "tuple",
        components: [
          { name: "to", type: "address" },
          { name: "validAfter", type: "uint256" },
          { name: "extra", type: "bytes" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

/** x402 Exact Permit2 Proxy ABI — settle function */
export const exactProxyAbi = [
  {
    name: "settle",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "permit",
        type: "tuple",
        components: [
          {
            name: "permitted",
            type: "tuple",
            components: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint256" },
            ],
          },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { name: "owner", type: "address" },
      {
        name: "witness",
        type: "tuple",
        components: [
          { name: "to", type: "address" },
          { name: "validAfter", type: "uint256" },
          { name: "extra", type: "bytes" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;
