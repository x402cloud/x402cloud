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
  /**
   * Hard ceiling on what a single 402 may ask for, in the asset's smallest
   * units (USDC: micro-USDC, so "10000" is $0.01). An offer above it is not
   * signed — `PriceExceedsMaxValueError` is thrown instead.
   *
   * Without this, the only thing bounding a charge is the wallet budget the
   * signature authorizes, which is normally far above one call's price. Any
   * caller that checked a price BEFORE calling (a catalog entry, a quote the
   * user approved) should pass that same number here, or the check it made was
   * against a price it never signs.
   */
  maxValue?: string;
};
