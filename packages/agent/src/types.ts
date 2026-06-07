import type { ClientSigner } from "@x402cloud/evm";
import type { MarketplaceService } from "@x402cloud/protocol";
import type { BudgetTracker } from "./budget.js";

export type { MarketplaceService };
export type { BudgetTracker } from "./budget.js";

/**
 * Budget caps for an agent session. Both fields are optional.
 *
 * Values are dollar-denominated strings like `"$0.10"` to match the marketplace
 * `maxPrice` shape. Parsing rules: leading `$` is optional, must be a finite
 * non-negative number.
 *
 * Budget tracking is in-memory per-process. If your process restarts, counters
 * reset. Persistent budget enforcement is the caller's job.
 */
export type Budget = {
  /** Cap for a single `call()`. e.g. "$0.10" */
  perCall?: string;
  /** Cap for a UTC calendar day. e.g. "$5" */
  perDay?: string;
};

export type DiscoverFilter = {
  /** Filter by category, e.g. "inference" */
  category?: string;
  /** Filter by tag, exact match */
  tag?: string;
  /** Free-text query matched against id/name/description/tags */
  q?: string;
};

export type AgentClientOptions = {
  /** Signer used to authorize x402 payments */
  signer: ClientSigner;
  /** Marketplace base URL. Default: https://marketplace.x402cloud.ai */
  catalogUrl?: string;
  /**
   * Optional opt-in budget caps. If provided, the SDK creates an in-memory
   * tracker — fine for one-shot CLIs, silently wrong for multi-instance
   * Workers. For those, pass `tracker` instead and ignore `budget`.
   */
  budget?: Budget;
  /**
   * Custom budget tracker (e.g. KV-backed for multi-instance deployments).
   * Takes precedence over `budget`. Implement `BudgetTracker` to plug your
   * own persistence.
   */
  tracker?: BudgetTracker;
  /** Override fetch (testing). Default: globalThis.fetch */
  fetch?: typeof fetch;
};

/** Thrown when a budget cap would be exceeded by a call. */
export class BudgetExceededError extends Error {
  constructor(
    public readonly kind: "perCall" | "perDay",
    public readonly attemptedUsd: number,
    public readonly capUsd: number,
    public readonly serviceId: string,
  ) {
    super(
      `Budget exceeded (${kind}): service "${serviceId}" would cost $${attemptedUsd} but cap is $${capUsd}`,
    );
    this.name = "BudgetExceededError";
  }
}

/** Thrown when a service id cannot be resolved from the catalog. */
export class ServiceNotFoundError extends Error {
  constructor(public readonly serviceId: string) {
    super(
      `Unknown service id "${serviceId}". Call discover() to list available services.`,
    );
    this.name = "ServiceNotFoundError";
  }
}
