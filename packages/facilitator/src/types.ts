import type { Network, PaymentRequirements, VerifyResponse, SettleResponse } from "@x402cloud/protocol";
import type { UptoPayload } from "@x402cloud/evm";
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

export type Facilitator = {
  /** Verify a payment authorization (no on-chain tx) */
  verify(payload: UptoPayload, requirements: PaymentRequirements): Promise<VerifyResponse>;
  /** Settle a payment on-chain for the given amount */
  settle(payload: UptoPayload, requirements: PaymentRequirements, settlementAmount: string): Promise<SettleResponse>;
  /** Facilitator's address (pays gas) */
  address: `0x${string}`;
  /** Supported network */
  network: Network;
};
