import {
  decodeRequirementsHeader,
  encodePaymentHeader,
  normalizeRequirements,
  type PaymentRequired,
} from "@x402cloud/protocol";
import { createUptoPayload, createExactPayload } from "@x402cloud/evm";
import type { PaymentClientConfig, SchemeHandler } from "./types.js";

/**
 * Thrown when a 402 quotes more than the caller's `maxValue`. Carries both
 * numbers (smallest units) so a caller can report what it refused.
 */
export class PriceExceedsMaxValueError extends Error {
  constructor(
    public readonly quoted: string,
    public readonly maxValue: string,
    public readonly resourceUrl?: string,
  ) {
    super(
      `x402 offer quotes ${quoted} but maxValue is ${maxValue}` +
        (resourceUrl ? ` (${resourceUrl})` : ""),
    );
    this.name = "PriceExceedsMaxValueError";
  }
}

const defaultSchemeHandlers: Record<string, SchemeHandler> = {
  upto: (signer, requirements) =>
    createUptoPayload(signer, requirements) as Promise<Record<string, unknown>>,
  exact: (signer, requirements) =>
    createExactPayload(signer, requirements) as Promise<Record<string, unknown>>,
};

/**
 * Wrap native fetch to auto-handle x402 payment responses.
 *
 * When a 402 is received:
 * 1. Parse PaymentRequired from response
 * 2. Sign payment authorization via scheme handler
 * 3. Retry request with PAYMENT-SIGNATURE header
 */
export function wrapFetchWithPayment(
  config: PaymentClientConfig,
): typeof fetch {
  const { signer, maxRetries = 1, maxValue } = config;
  const schemes: Record<string, SchemeHandler> = {
    ...defaultSchemeHandlers,
    ...config.schemeHandlers,
  };

  return async function paymentFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    let response = await fetch(input, init);

    for (let attempt = 0; attempt < maxRetries && response.status === 402; attempt++) {
      // Try to get requirements from header first (v2), then body
      let paymentRequired: PaymentRequired;

      const requirementsHeader = response.headers.get("PAYMENT-REQUIRED");
      if (requirementsHeader) {
        paymentRequired = decodeRequirementsHeader(requirementsHeader);
      } else {
        paymentRequired = (await response.json()) as PaymentRequired;
      }

      if (!paymentRequired.accepts?.length) {
        break; // No payment options available
      }

      // Pick the first accepted payment method. Parsing here is what decides
      // WHICH number we sign — the offer came from a remote server, so a
      // payload whose two price spellings disagree is rejected rather than
      // resolved in the server's favour.
      const requirements = normalizeRequirements(paymentRequired.accepts[0]);

      // The price we are about to sign, checked against the caller's ceiling
      // BEFORE signing. This is the same number `requirements.amount` puts in
      // the Permit2 authorization, so there is no gap between what was checked
      // and what is signed.
      if (maxValue !== undefined && BigInt(requirements.amount) > BigInt(maxValue)) {
        throw new PriceExceedsMaxValueError(
          requirements.amount,
          maxValue,
          paymentRequired.resource?.url,
        );
      }

      // Sign payment based on scheme
      const handler = schemes[requirements.scheme];
      if (!handler) {
        break; // Unsupported scheme
      }
      const payloadData = await handler(signer, requirements);

      // Build full payment payload
      const paymentPayload = {
        x402Version: paymentRequired.x402Version ?? 2,
        resource: paymentRequired.resource,
        accepted: requirements,
        payload: payloadData,
      };

      // Encode and retry
      const encoded = encodePaymentHeader(paymentPayload);
      const retryInit: RequestInit = {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers).entries()),
          "PAYMENT-SIGNATURE": encoded,
        },
      };

      response = await fetch(input, retryInit);
    }

    return response;
  };
}
