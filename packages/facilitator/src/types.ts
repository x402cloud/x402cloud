import type { Network, PaymentRequirements, VerifyResponse, SettleResponse, Scheme } from "@x402cloud/protocol";
import type { UptoPayload, ExactPayload } from "@x402cloud/evm";
import type { Chain } from "viem";
import type { FeeEstimate } from "./fee.js";

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
  /**
   * Chainlink ETH/USD feed address for this network (workspace#45's
   * computed settlement-fee floor — see `estimateFee`). Deliberately no
   * built-in default: an unverified address is worse than failing closed.
   * Omitting it means every fee estimate uses the fail-closed fallback
   * (`degraded: true`) for the ETH/USD leg — a safe, explicit degraded mode
   * rather than a silently-wrong guess. Verify the address for your network
   * at https://docs.chain.link/data-feeds/price-feeds/addresses before
   * setting this on mainnet.
   */
  ethUsdFeedAddress?: `0x${string}`;
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

  /**
   * Confirm the on-chain outcome of an ALREADY-BROADCAST settlement tx.
   *
   * Looks up the receipt for `txHash` and returns success / transaction_reverted
   * / settlement_pending_receipt. NEVER re-broadcasts — used by the durable
   * retry path for transactions stuck in `awaiting_receipt`. Receipt status is
   * scheme-agnostic, so one confirm serves both upto and exact.
   */
  confirm(txHash: `0x${string}`, network: Network, settledAmount: string): Promise<SettleResponse>;

  /** Facilitator's address (pays gas) */
  address: `0x${string}`;
  /** Supported network */
  network: Network;

  /**
   * Computed settlement-fee floor for one scheme, on this facilitator's
   * configured network (workspace#45). Backs the `/fee` route and rides on
   * `verify`/`verifyExact`'s result (`settlementFee`/`feeDegraded`) so a
   * meter can floor its retail price without a second network call.
   * Optional: a `Facilitator` built by hand (e.g. in a test) may omit it.
   */
  estimateFee?(scheme: Scheme): Promise<FeeEstimate>;
};
