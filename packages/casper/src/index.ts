// Constants
export {
  CASPER_MAINNET,
  CASPER_TESTNET,
  CASPER_NETWORKS,
  CASPER_SCHEME,
  NETWORK_NAME_TO_CAIP2,
  resolveNetwork,
  DEFAULT_FACILITATOR_URL,
  DEFAULT_FACILITATOR_TIMEOUT_MS,
  MOTES_DECIMALS,
  MOTES_PER_CSPR,
  DEFAULT_WCSPR_CONTRACTS,
  WCSPR_CONTRACT_ENV_VARS,
  wcsprContract,
} from "./constants.js";

// Types
export type {
  CasperExactPayload,
  CasperAuthorization,
  CasperFacilitatorConfig,
  CasperSupportedKind,
  FetchLike,
  FetchLikeResponse,
} from "./types.js";

// Facilitator client (HTTP port to the hosted Casper facilitator)
export { createCasperFacilitatorClient } from "./facilitator-client.js";
export type { CasperFacilitatorClient, FacilitatorCall } from "./facilitator-client.js";

// Exact scheme
export { verifyExact } from "./exact/verify.js";
export { settleExact } from "./exact/settle.js";

// Scheme registry (the seam `@x402cloud/facilitator` mounts)
export { createCasperSchemes } from "./schemes.js";
export type { CasperSchemeHandler, CreateCasperSchemesOptions } from "./schemes.js";

// Payload parsing (runtime validation at decode boundary)
export { parseCasperExactPayload } from "./parse.js";

// Preflight (local, network-free precondition checks)
export { preflight, facilitatorRequestBody } from "./shared.js";
export type { PreflightResult } from "./shared.js";

// Utils
export {
  isCasperNetwork,
  assertCasperNetwork,
  parseUnixSeconds,
  parseMotes,
  csprToMotes,
  formatMotes,
  MAX_UNIX_SECONDS,
} from "./utils.js";

// Errors
export { sanitizeErrorMessage, CASPER_ERRORS } from "./errors.js";
export type { CasperErrorReason } from "./errors.js";
