/** CAIP-2 network identifier (e.g., "eip155:8453" for Base) */
export type Network = `${string}:${string}`;

/** Payment scheme identifier */
export type Scheme = "exact" | "upto";

/**
 * What the server accepts as payment, PARSED — every field is present and
 * trusted. `amount` is the price in the asset's smallest units, spelled the way
 * the x402 v2 specification spells it. There is one price field.
 *
 * The wire additionally carries `maxAmount`, this implementation's original
 * name for the same value, so clients pinned to the old spelling keep working.
 * That mirror is added on the way out (`toWireRequirements`, `headers.ts`) and
 * dropped on the way in (`parseRequirements`) — it never exists as a second
 * source of truth in memory. See DESIGN.md § The price field.
 */
export type PaymentRequirements = {
  readonly scheme: Scheme;
  readonly network: Network;
  readonly asset: string;
  /** Price in the asset's smallest units (USDC: 6 decimals), decimal string. */
  readonly amount: string;
  readonly payTo: string;
  readonly maxTimeoutSeconds: number;
  readonly extra?: Readonly<Record<string, unknown>>;
};

/**
 * Requirements as they ARRIVED FROM OUTSIDE — a remote server's 402, an HTTP
 * request body. Either price spelling may be present, both, or neither, and
 * nothing here is trusted until `parseRequirements` has looked at it.
 */
export type PaymentRequirementsInput = Omit<PaymentRequirements, "amount"> & {
  readonly amount?: string;
  /** Legacy spelling of `amount`. Accepted on input, never canonical. */
  readonly maxAmount?: string;
};

/** The result of parsing untrusted input: a value, or a reason it is not one. */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Parse requirements that came from outside into the canonical shape.
 *
 * `amount` wins: it is the spec field every conformant client, wallet UI and
 * budget guard reads, so it is the number the payer was shown. A payload
 * carrying both spellings with DIFFERENT values is rejected outright — that is
 * a server showing one price and asking to be paid another, not a variation we
 * accommodate. Returns a result value rather than throwing so HTTP boundaries
 * can answer with a real reason instead of a bare 500.
 */
export function parseRequirements(
  input: PaymentRequirementsInput | null | undefined,
): ParseResult<PaymentRequirements> {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "requirements missing" };
  }

  const { amount, maxAmount, ...rest } = input;

  if (amount && maxAmount && amount !== maxAmount) {
    return {
      ok: false,
      error: `requirements price is ambiguous: amount "${amount}" != maxAmount "${maxAmount}"`,
    };
  }

  const price = amount ?? maxAmount;
  if (!price) {
    return { ok: false, error: "requirements has no price (`amount`)" };
  }

  return { ok: true, value: { ...rest, amount: price } };
}

/**
 * `parseRequirements` for call sites where a bad offer is an exception, not a
 * response — signing, mainly. Throws the parse error.
 */
export function normalizeRequirements(
  requirements: PaymentRequirementsInput,
): PaymentRequirements {
  const parsed = parseRequirements(requirements);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

/** Resource being paid for */
export type ResourceInfo = {
  readonly url: string;
  readonly description?: string;
  readonly mimeType?: string;
};

/** 402 response envelope */
export type PaymentRequired = {
  readonly x402Version: number;
  readonly error?: string;
  readonly resource: ResourceInfo;
  readonly accepts: readonly PaymentRequirements[];
};

/** Client's payment proof sent in header */
export type PaymentPayload = {
  readonly x402Version: number;
  readonly resource: ResourceInfo;
  readonly accepted: PaymentRequirements;
  readonly payload: Readonly<Record<string, unknown>>;
};

/** Facilitator verification result */
export type VerifyResponse =
  | { readonly isValid: true; readonly payer: string }
  | { readonly isValid: false; readonly invalidReason: string };

/** Facilitator settlement result */
export type SettleResponse =
  | {
      readonly success: true;
      readonly transaction: string;
      readonly network: Network;
      readonly settledAmount: string;
    }
  | { readonly success: false; readonly errorReason: string };

/** Meter function: computes actual cost after request completes */
export type MeterFunction = (ctx: {
  request: Request;
  response: Response;
  authorizedAmount: string;
  payer: string;
}) => Promise<string> | string;

/** Route configuration for payment middleware */
export type RouteConfig = {
  readonly scheme: Scheme;
  readonly network: Network;
  readonly asset?: string;
  readonly maxPrice: string;
  readonly payTo: string;
  readonly maxTimeoutSeconds?: number;
  readonly description?: string;
  readonly meter?: MeterFunction;
};

export type RoutesConfig = Record<string, RouteConfig>;

/** Canonical settlement event emitted after on-chain settlement */
export type SettlementEvent = {
  readonly txHash: string;
  readonly blockNumber: number;
  readonly timestamp: number;
  readonly network: string;
  readonly scheme: string;
  readonly facilitator: string;
  readonly payer: string;
  readonly payee: string;
  readonly amount: string;
  readonly amountUsd: number;
  readonly token: string;
};
