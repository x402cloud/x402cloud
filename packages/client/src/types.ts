import type { ClientSigner } from "@x402cloud/evm";
import type { PaymentRequirements } from "@x402cloud/protocol";

/** Creates a payment payload for a given scheme */
export type SchemeHandler = (
  signer: ClientSigner,
  requirements: PaymentRequirements,
) => Promise<Record<string, unknown>>;

export type PaymentClientConfig = {
  /** Wallet signer for signing payment authorizations */
  signer: ClientSigner;
  /** Max retries after 402 (default: 1) */
  maxRetries?: number;
  /** Custom scheme handlers — keyed by scheme name (e.g., "upto", "exact") */
  schemeHandlers?: Record<string, SchemeHandler>;
};
