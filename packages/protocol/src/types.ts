/** CAIP-2 network identifier (e.g., "eip155:8453" for Base) */
export type Network = `${string}:${string}`;

/** Payment scheme identifier */
export type Scheme = "exact" | "upto";

/** What the server accepts as payment */
export type PaymentRequirements = {
  scheme: Scheme;
  network: Network;
  asset: string;
  maxAmount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
};

/** Resource being paid for */
export type ResourceInfo = {
  url: string;
  description?: string;
  mimeType?: string;
};

/** 402 response envelope */
export type PaymentRequired = {
  x402Version: number;
  error?: string;
  resource: ResourceInfo;
  accepts: PaymentRequirements[];
};

/** Client's payment proof sent in header */
export type PaymentPayload = {
  x402Version: number;
  resource: ResourceInfo;
  accepted: PaymentRequirements;
  payload: Record<string, unknown>;
};

/**
 * Facilitator verification result.
 *
 * `settlementFee` and `feeDegraded` are additive, optional fields (workspace#45):
 * the facilitator owns the wallet/RPC that pays for settlement, so it is the
 * only party that can compute the current gas-cost floor for this settle. It
 * rides on the existing /verify round trip rather than requiring a second
 * network call — a server that ignores the fields behaves exactly as before.
 *
 *   settlementFee  — current computed settlement-fee floor, USDC smallest
 *                     units (6 decimals) as a decimal string. Present only
 *                     when the facilitator supports fee computation.
 *   feeDegraded    — true when `settlementFee` came from the fail-closed
 *                     fallback (a live gas/price read failed) rather than a
 *                     live read. Never absent when `settlementFee` is present.
 */
export type VerifyResponse =
  | { isValid: true; payer: string; settlementFee?: string; feeDegraded?: boolean }
  | { isValid: false; invalidReason: string };

/** Facilitator settlement result */
export type SettleResponse =
  | { success: true; transaction: string; network: Network; settledAmount: string }
  | { success: false; errorReason: string };

/**
 * Meter function: computes actual cost after request completes.
 *
 * `settlementFee`/`feeDegraded` mirror the same fields on `VerifyResponse` —
 * the middleware threads them straight from the verify result that admitted
 * this request, so a meter can floor its retail price at the current gas
 * cost (`retailPrice(wholesale, authorizedAmount, marginBps, settlementFee)`)
 * without making its own call to the facilitator.
 */
export type MeterFunction = (ctx: {
  request: Request;
  response: Response;
  authorizedAmount: string;
  payer: string;
  settlementFee?: string;
  feeDegraded?: boolean;
}) => Promise<string> | string;

/** Route configuration for payment middleware */
export type RouteConfig = {
  scheme: Scheme;
  network: Network;
  asset?: string;
  maxPrice: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  description?: string;
  meter?: MeterFunction;
};

export type RoutesConfig = Record<string, RouteConfig>;

/** Canonical settlement event emitted after on-chain settlement */
export type SettlementEvent = {
  txHash: string;
  blockNumber: number;
  timestamp: number;
  network: string;
  scheme: string;
  facilitator: string;
  payer: string;
  payee: string;
  amount: string;
  amountUsd: number;
  token: string;
};
