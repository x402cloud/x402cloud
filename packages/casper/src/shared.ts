import type { PaymentRequirements } from "@x402cloud/protocol";
import { CASPER_ERRORS, type CasperErrorReason } from "./errors.js";
import { CASPER_SCHEME, wcsprContract } from "./constants.js";
import { isCasperNetwork, parseMotes } from "./utils.js";
import { parseCasperExactPayload } from "./parse.js";
import type { CasperExactPayload } from "./types.js";

/** A precondition check either passes or names exactly why it failed. */
export type PreflightResult =
  | { ok: true; payload: CasperExactPayload; asset: string }
  | { ok: false; reason: CasperErrorReason };

/**
 * Local, network-free checks run before any facilitator round-trip.
 *
 * Everything here is cheap and deterministic: the network family, the scheme,
 * the payload's structure, the configured wCSPR contract, and the agreement
 * between the payload and the requirements it claims to answer. Failing here
 * saves a round-trip and, more importantly, guarantees the facilitator only
 * ever sees payloads we already believe are well-formed.
 */
export function preflight(
  payload: Record<string, unknown>,
  requirements: PaymentRequirements,
  env: Record<string, string | undefined> = process.env,
): PreflightResult {
  if (!isCasperNetwork(requirements.network)) {
    return { ok: false, reason: CASPER_ERRORS.UNSUPPORTED_NETWORK };
  }
  if (requirements.scheme !== CASPER_SCHEME) {
    return { ok: false, reason: CASPER_ERRORS.UNSUPPORTED_SCHEME };
  }

  const parsed = parseCasperExactPayload(payload);
  if (!parsed) {
    return { ok: false, reason: CASPER_ERRORS.INVALID_PAYLOAD };
  }

  // The requirements' asset wins when present; otherwise fall back to the
  // operator-configured contract for this network. An unknown asset is fatal —
  // settling against an unverified CEP-18 contract is how you get paid in a
  // worthless token.
  const asset = requirements.asset || wcsprContract(requirements.network, env);
  if (!asset) {
    return { ok: false, reason: CASPER_ERRORS.ASSET_NOT_CONFIGURED };
  }

  const auth = parsed.authorization;
  if (auth.network !== requirements.network) {
    return { ok: false, reason: CASPER_ERRORS.REQUIREMENTS_MISMATCH };
  }
  if (auth.asset.toLowerCase() !== asset.toLowerCase()) {
    return { ok: false, reason: CASPER_ERRORS.REQUIREMENTS_MISMATCH };
  }
  if (auth.to.toLowerCase() !== requirements.payTo.toLowerCase()) {
    return { ok: false, reason: CASPER_ERRORS.REQUIREMENTS_MISMATCH };
  }

  const authorized = parseMotes(auth.value);
  const maxAmount = parseMotes(requirements.maxAmount);
  if (authorized === null || maxAmount === null) {
    return { ok: false, reason: CASPER_ERRORS.INVALID_PAYLOAD };
  }
  // `exact` means exact: the signed amount must equal what the resource asks
  // for, so a payer cannot under- (or over-) pay by reusing an authorization.
  if (authorized !== maxAmount) {
    return { ok: false, reason: CASPER_ERRORS.REQUIREMENTS_MISMATCH };
  }

  return { ok: true, payload: parsed, asset };
}

/** Build the x402 v2 request body the facilitator expects. */
export function facilitatorRequestBody(
  payload: CasperExactPayload,
  requirements: PaymentRequirements,
): Record<string, unknown> {
  return {
    x402Version: 2,
    paymentPayload: {
      x402Version: 2,
      scheme: CASPER_SCHEME,
      network: requirements.network,
      payload,
    },
    paymentRequirements: requirements,
  };
}
