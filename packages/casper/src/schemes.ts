import type { PaymentRequirements, SettleResponse, VerifyResponse } from "@x402cloud/protocol";
import type { CasperFacilitatorConfig } from "./types.js";
import { createCasperFacilitatorClient, type CasperFacilitatorClient } from "./facilitator-client.js";
import { verifyExact } from "./exact/verify.js";
import { settleExact } from "./exact/settle.js";

/**
 * A scheme handler in the shape `@x402cloud/facilitator` dispatches on — same
 * `verify`/`settle` signature as the EVM handlers, so a Casper network can be
 * mounted next to an EVM one without the facilitator core learning anything
 * chain-specific.
 */
export type CasperSchemeHandler = {
  verify(payload: Record<string, unknown>, requirements: PaymentRequirements): Promise<VerifyResponse>;
  settle(
    payload: Record<string, unknown>,
    requirements: PaymentRequirements,
    ...args: unknown[]
  ): Promise<SettleResponse>;
};

/** Options for {@link createCasperSchemes}. */
export type CreateCasperSchemesOptions = CasperFacilitatorConfig & {
  /** Pre-built client (mostly for tests); otherwise one is constructed. */
  client?: CasperFacilitatorClient;
};

/**
 * Build the `{ exact: handler }` map for Casper networks.
 *
 * Casper supports the `exact` scheme only: `upto` requires an on-chain
 * partial-capture primitive that the wCSPR CEP-18 flow does not provide, so
 * advertising it would be a lie. Add it here if that changes.
 */
export function createCasperSchemes(
  options: CreateCasperSchemesOptions = {},
): Record<string, CasperSchemeHandler> {
  const { client: injected, ...config } = options;
  const client = injected ?? createCasperFacilitatorClient(config);
  const env = config.env ?? process.env;

  return {
    exact: {
      verify: (payload, requirements) => verifyExact(client, payload, requirements, env),
      settle: (payload, requirements) => settleExact(client, payload, requirements, env),
    },
  };
}
