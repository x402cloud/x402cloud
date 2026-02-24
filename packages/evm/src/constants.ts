import { base, baseSepolia } from "viem/chains";
import type { Chain } from "viem";

/** Network CAIP-2 ID → viem Chain object */
export const CHAINS: Record<string, Chain> = {
  "eip155:8453": base,
  "eip155:84532": baseSepolia,
};

/** Uniswap Permit2 — canonical address on all EVM chains */
export const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

/** Coinbase-deployed x402 proxy for exact (fixed) payments */
export const X402_EXACT_PROXY = "0x4020615294c913F045dc10f0a5cdEbd86c280001" as const;

/** Coinbase-deployed x402 proxy for upto (metered) payments */
export const X402_UPTO_PROXY = "0x4020633461b2895a48930Ff97eE8fCdE8E520002" as const;

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
