export { createFacilitator } from "./create.js";
export { createFacilitatorRoutes } from "./routes.js";
export {
  isTransientFailure,
  classifySettlement,
  pendingReceiptTxHash,
  type SettlementClass,
} from "./settlement.js";
export type { CreateFacilitatorRoutesOptions } from "./routes.js";
export type { FacilitatorConfig, Facilitator, SchemeHandler } from "./types.js";

// Computed settlement-fee floor (workspace#45)
export {
  computeSettlementFee,
  settleGasUnits,
  SETTLE_GAS_UNITS,
  SETTLE_CALLDATA_BYTES,
  SAFETY_MULTIPLIER,
  FALLBACK_GAS_PRICE_WEI,
  FALLBACK_L1_FEE_WEI,
  FALLBACK_ETH_USD,
} from "./fee.js";
export type {
  FeeEstimate,
  FeeDataReader,
  L1DataFeeReader,
  EthUsdReader,
  FeeReaders,
  ComputeSettlementFeeInputs,
} from "./fee.js";
export { cachedFeeEstimator } from "./fee-cache.js";
export {
  viemFeeDataReader,
  viemL1DataFeeReader,
  chainlinkEthUsdReader,
  OP_STACK_GAS_PRICE_ORACLE,
} from "./fee-readers.js";
