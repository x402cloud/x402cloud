import { base, baseSepolia } from "viem/chains";
import type { Chain } from "viem";

/** Network CAIP-2 ID → viem Chain object */
export const CHAINS: Record<string, Chain> = {
  "eip155:8453": base,
  "eip155:84532": baseSepolia,
};

/**
 * Friendly chain name → CAIP-2 network identifier. Centralized so apps don't
 * each define their own NETWORK_MAP. Add new entries as new networks are
 * supported. Names are lowercase, hyphenated.
 */
export const NETWORK_NAME_TO_CAIP2: Readonly<Record<string, `eip155:${string}`>> = Object.freeze({
  "ethereum": "eip155:1",
  "optimism": "eip155:10",
  "polygon": "eip155:137",
  "base": "eip155:8453",
  "base-sepolia": "eip155:84532",
  "arbitrum": "eip155:42161",
  "arbitrum-sepolia": "eip155:421614",
  "avalanche": "eip155:43114",
});

/** Resolve a name like "base" to its CAIP-2 network. Throws on unknown. */
export function resolveNetwork(name: string): `eip155:${string}` {
  const caip2 = NETWORK_NAME_TO_CAIP2[name];
  if (!caip2) {
    throw new Error(
      `Unknown network "${name}". Known: ${Object.keys(NETWORK_NAME_TO_CAIP2).join(", ")}`,
    );
  }
  return caip2;
}

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
 * Canonical Coinbase x402ExactPermit2Proxy (exact / fixed payments).
 *
 * Deployed via deterministic CREATE2, so the address is identical on Base
 * mainnet (eip155:8453) AND Base Sepolia (eip155:84532) — code verified on
 * both. Source: github.com/coinbase/x402 contracts/evm/src (vendored under
 * `contracts/` for reference).
 */
export const X402_EXACT_PROXY = "0x402085c248EeA27D92E8b30b2C58ed07f9E20001" as const;

/**
 * Canonical Coinbase x402UptoPermit2Proxy (upto / metered payments).
 *
 * Deployed via deterministic CREATE2, so the address is identical on Base
 * mainnet (eip155:8453) AND Base Sepolia (eip155:84532) — code verified on
 * both. Source: github.com/coinbase/x402 contracts/evm/src (vendored under
 * `contracts/` for reference).
 */
export const X402_UPTO_PROXY = "0x4020A4f3b7b90ccA423B9fabCc0CE57C6C240002" as const;

/** The two proxy addresses used by a given chain. */
export type ProxyAddresses = {
  /** Spender/verifyingContract for the exact (fixed) scheme. */
  exact: `0x${string}`;
  /** Spender/verifyingContract for the upto (metered) scheme. */
  upto: `0x${string}`;
};

/**
 * Per-chain proxy addresses, keyed by CAIP-2 network id.
 *
 * The canonical Coinbase proxies are CREATE2-deployed at the SAME address on
 * every supported chain, so both Base networks map to the `X402_*_PROXY`
 * constants. New chains accrete by adding an entry (or, if Coinbase deploys
 * at the same CREATE2 address there too, by relying on the fallback in
 * {@link proxyAddresses}).
 */
export const PROXY_ADDRESSES: Readonly<Record<string, ProxyAddresses>> = Object.freeze({
  "eip155:8453":  { exact: X402_EXACT_PROXY, upto: X402_UPTO_PROXY },
  "eip155:84532": { exact: X402_EXACT_PROXY, upto: X402_UPTO_PROXY },
});

/**
 * Resolve the exact/upto proxy addresses for a CAIP-2 network.
 *
 * Falls back to the canonical `X402_*_PROXY` constants for any chain not
 * present in {@link PROXY_ADDRESSES} (correct wherever Coinbase's CREATE2
 * deployment exists). Verify bytecode before settling on a new chain — see
 * scripts/verify-mainnet-proxies.ts.
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

/** One field of a proxy's EIP-712 Witness struct (data, not mechanism). */
export type WitnessField = { name: string; type: "address" | "uint256" };

/**
 * Witness fields of the canonical x402UptoPermit2Proxy.
 * Solidity: `Witness(address to,address facilitator,uint256 validAfter)`.
 * `facilitator` binds settlement to one caller — the contract requires
 * `msg.sender == witness.facilitator`.
 */
export const UPTO_WITNESS_FIELDS: readonly WitnessField[] = Object.freeze([
  { name: "to", type: "address" },
  { name: "facilitator", type: "address" },
  { name: "validAfter", type: "uint256" },
]);

/**
 * Witness fields of the canonical x402ExactPermit2Proxy.
 * Solidity: `Witness(address to,uint256 validAfter)`.
 */
export const EXACT_WITNESS_FIELDS: readonly WitnessField[] = Object.freeze([
  { name: "to", type: "address" },
  { name: "validAfter", type: "uint256" },
]);

/**
 * EIP-712 types for Permit2 `PermitWitnessTransferFrom` with the given
 * Witness struct. The scaffold is shared; the witness fields are injected
 * per scheme ({@link UPTO_WITNESS_FIELDS} / {@link EXACT_WITNESS_FIELDS}).
 */
export function permit2WitnessTypes(witnessFields: readonly WitnessField[]) {
  return {
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
    Witness: witnessFields as { name: string; type: string }[],
  } as const;
}

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

/** Permit2 `PermitTransferFrom` tuple — shared by both proxy ABIs. */
const permitTransferFromComponents = [
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
] as const;

/**
 * Canonical x402UptoPermit2Proxy ABI — settle function.
 * `settle(PermitTransferFrom permit, uint256 amount, address owner, Witness witness, bytes signature)`
 * with `Witness(address to, address facilitator, uint256 validAfter)`.
 */
export const uptoProxyAbi = [
  {
    name: "settle",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "permit", type: "tuple", components: permitTransferFromComponents },
      { name: "amount", type: "uint256" },
      { name: "owner", type: "address" },
      {
        name: "witness",
        type: "tuple",
        components: [
          { name: "to", type: "address" },
          { name: "facilitator", type: "address" },
          { name: "validAfter", type: "uint256" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

/**
 * Canonical x402ExactPermit2Proxy ABI — settle function.
 * `settle(PermitTransferFrom permit, address owner, Witness witness, bytes signature)`
 * with `Witness(address to, uint256 validAfter)`. Always transfers the exact
 * permitted amount.
 */
export const exactProxyAbi = [
  {
    name: "settle",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "permit", type: "tuple", components: permitTransferFromComponents },
      { name: "owner", type: "address" },
      {
        name: "witness",
        type: "tuple",
        components: [
          { name: "to", type: "address" },
          { name: "validAfter", type: "uint256" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;
