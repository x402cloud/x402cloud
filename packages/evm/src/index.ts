// Constants
export {
  CHAINS,
  NETWORK_NAME_TO_CAIP2,
  resolveNetwork,
  PERMIT2_ADDRESS,
  SETTLEMENT_RECEIPT_TIMEOUT_MS,
  X402_EXACT_PROXY,
  X402_UPTO_PROXY,
  PROXY_ADDRESSES,
  proxyAddresses,
  DEFAULT_USDC_ADDRESSES,
  permit2Domain,
  permit2WitnessTypes,
  erc20Abi,
  uptoProxyAbi,
  exactProxyAbi,
} from "./constants.js";

export type { ProxyAddresses } from "./constants.js";

// Types
export type {
  Permit2Witness,
  Permit2Authorization,
  UptoPayload,
  ExactPayload,
  ClientSigner,
  VerifySigner,
  FacilitatorSigner,
} from "./types.js";

// Upto scheme
export { createUptoPayload } from "./upto/client.js";
export { verifyUpto } from "./upto/verify.js";
export { settleUpto } from "./upto/settle.js";

// Exact scheme
export { createExactPayload } from "./exact/client.js";
export { verifyExact } from "./exact/verify.js";
export { settleExact } from "./exact/settle.js";

// Confirm (scheme-agnostic receipt confirmation of an already-broadcast tx)
export { confirmSettlement } from "./confirm.js";

// Payload parsing (runtime validation at decode boundary)
export { parseUptoPayload, parseExactPayload } from "./parse.js";

// Utils
export { parseChainId, parseUnixSeconds, MAX_UNIX_SECONDS } from "./utils.js";

// Errors
export { sanitizeErrorMessage } from "./errors.js";
