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

/** Facilitator verification result */
export type VerifyResponse = {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
};

/** Facilitator settlement result */
export type SettleResponse = {
  success: boolean;
  errorReason?: string;
  transaction?: string;
  network?: Network;
  settledAmount?: string;
};

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
