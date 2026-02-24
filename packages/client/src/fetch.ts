import {
  decodeRequirementsHeader,
  encodePaymentHeader,
  type PaymentRequired,
} from "@x402cloud/protocol";
import { createUptoPayload, createExactPayload } from "@x402cloud/evm";
import type { PaymentClientConfig, SchemeHandler } from "./types.js";

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
  const { signer, maxRetries = 1 } = config;
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

      // Pick the first accepted payment method
      const requirements = paymentRequired.accepts[0];

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
