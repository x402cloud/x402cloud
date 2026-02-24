import type { Network, PaymentRequirements, VerifyResponse, SettleResponse } from "@x402cloud/protocol";
import type { UptoPayload, ExactPayload } from "@x402cloud/evm";
import type { Chain } from "viem";

export type FacilitatorConfig = {
  /** Facilitator's private key (pays gas for settlement) */
  privateKey: `0x${string}`;
  /** RPC URL for the target chain */
  rpcUrl: string;
  /** CAIP-2 network identifier */
  network: Network;
  /** viem Chain object for the target network */
  chain: Chain;
  /** Our payTo address (free facilitation for our own transactions) */
  ownAddress?: `0x${string}`;
  /** Fee in basis points for third-party transactions (e.g., 30 = 0.3%) */
  feeBasisPoints?: number;
};

/** A scheme handler knows how to verify and settle one payment scheme */
export type SchemeHandler = {
  /** Verify a payment payload (no on-chain tx) */
  verify(payload: Record<string, unknown>, requirements: PaymentRequirements): Promise<VerifyResponse>;
  /** Settle a payment on-chain */
  settle(payload: Record<string, unknown>, requirements: PaymentRequirements, ...args: unknown[]): Promise<SettleResponse>;
};

export type Facilitator = {
  /** Scheme-dispatched handlers — extensible map keyed by scheme name */
  schemes: Record<string, SchemeHandler>;

  // ── Backwards-compatible convenience methods ──────────────────────

  /** Verify an upto payment authorization (no on-chain tx) */
  verify(payload: UptoPayload, requirements: PaymentRequirements): Promise<VerifyResponse>;
  /** Settle an upto payment on-chain for the given amount */
  settle(payload: UptoPayload, requirements: PaymentRequirements, settlementAmount: string): Promise<SettleResponse>;
  /** Verify an exact payment authorization (no on-chain tx) */
  verifyExact(payload: ExactPayload, requirements: PaymentRequirements): Promise<VerifyResponse>;
  /** Settle an exact payment on-chain (full authorized amount) */
  settleExact(payload: ExactPayload, requirements: PaymentRequirements): Promise<SettleResponse>;

  /** Facilitator's address (pays gas) */
  address: `0x${string}`;
  /** Supported network */
  network: Network;
};
