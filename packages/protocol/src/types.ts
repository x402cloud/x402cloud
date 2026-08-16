/** CAIP-2 network identifier (e.g., "eip155:8453" for Base) */
export type Network = `${string}:${string}`;

/** Payment scheme identifier */
export type Scheme = "exact" | "upto";

/**
 * What the server accepts as payment.
 *
 * `amount` is the field name in the x402 v2 specification; `maxAmount` is this
 * implementation's original name for the same value and stays as the internal
 * canonical field so no call site has to change. Wire payloads carry BOTH, and
 * `normalizeRequirements` fills `maxAmount` from `amount` on the way in — so an
 * offer built by a spec-conformant server (amount only) and one built here are
 * both payable by both clients. Accretion, not breakage.
 */
export type PaymentRequirements = {
  scheme: Scheme;
  network: Network;
  asset: string;
  maxAmount: string;
  /** x402 v2 spelling of `maxAmount`. Always emitted; optional on input. */
  amount?: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
};

/**
 * Accept a `PaymentRequirements` written in either spelling and return one with
 * both fields populated. Throws if neither is present — a requirements object
 * without a price is not payable, and failing here beats signing `undefined`.
 */
export function normalizeRequirements(
  requirements: PaymentRequirements & { amount?: string },
): PaymentRequirements {
  const value = requirements.maxAmount ?? requirements.amount;
  if (!value) {
    throw new Error("PaymentRequirements is missing both `amount` and `maxAmount`");
  }
  return { ...requirements, maxAmount: value, amount: value };
}

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

/** Facilitator verification result */
export type VerifyResponse =
  | { isValid: true; payer: string }
  | { isValid: false; invalidReason: string };

/** Facilitator settlement result */
export type SettleResponse =
  | { success: true; transaction: string; network: Network; settledAmount: string }
  | { success: false; errorReason: string };

/** Meter function: computes actual cost after request completes */
export type MeterFunction = (ctx: {
  request: Request;
  response: Response;
  authorizedAmount: string;
  payer: string;
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
