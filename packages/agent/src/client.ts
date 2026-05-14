import { wrapFetchWithPayment } from "@x402cloud/client";
import type { MarketplaceService } from "@x402cloud/protocol";
import { fetchCatalog, fetchService } from "./catalog.js";
import {
  createInMemoryBudgetTracker,
  microUsdcToUsd,
  parsePriceUsd,
} from "./budget.js";
import {
  ServiceNotFoundError,
  type AgentClientOptions,
  type DiscoverFilter,
} from "./types.js";

/** Header set by `@x402cloud/middleware` carrying the settled USDC micro-amount. */
const X_PAYMENT_SETTLED = "X-Payment-Settled";

const DEFAULT_CATALOG_URL = "https://marketplace.x402cloud.ai";

export type AgentClient = {
  /** List services in the catalog. Always hits the network. */
  discover: (filter?: DiscoverFilter) => Promise<MarketplaceService[]>;
  /** Fetch a single service by id. Throws `ServiceNotFoundError` if missing. */
  getService: (id: string) => Promise<MarketplaceService>;
  /**
   * One-line paid call. Looks the service up in the catalog, signs payment,
   * and returns parsed JSON. Throws on non-2xx responses with the upstream
   * status + body verbatim.
   */
  call: <T = unknown>(id: string, body?: unknown) => Promise<T>;
  /** Return a `fetch` that auto-pays for the given service id. */
  fetchFor: (id: string) => Promise<typeof fetch>;
};

export function createAgentClient(opts: AgentClientOptions): AgentClient {
  const catalogUrl = opts.catalogUrl ?? DEFAULT_CATALOG_URL;
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  // Caller-supplied tracker wins. Falls back to in-memory if `budget` is set.
  const tracker = opts.tracker ?? createInMemoryBudgetTracker(opts.budget);
  const payingFetch = wrapFetchWithPayment({ signer: opts.signer });

  async function getService(id: string): Promise<MarketplaceService> {
    const svc = await fetchService(catalogUrl, id, fetchImpl);
    if (!svc) throw new ServiceNotFoundError(id);
    return svc;
  }

  return {
    discover: (filter) => fetchCatalog(catalogUrl, filter, fetchImpl),

    getService,

    async fetchFor(id) {
      // Resolve the service once so callers fail fast on unknown ids.
      await getService(id);
      return payingFetch;
    },

    async call<T = unknown>(id: string, body?: unknown): Promise<T> {
      const svc = await getService(id);
      // Pre-flight check uses maxPrice (worst case). The actual recorded
      // amount comes from `X-Payment-Settled` after the call succeeds.
      const maxUsd = parsePriceUsd(svc.payment.maxPrice);
      tracker.check(id, maxUsd);

      const res = await payingFetch(svc.endpoint.url, {
        method: svc.endpoint.method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const err = new Error(
          `Service "${id}" returned ${res.status} ${res.statusText}: ${text}`,
        ) as Error & { status?: number; body?: string };
        err.status = res.status;
        err.body = text;
        throw err;
      }

      // Record the actual settled amount, not the worst-case authorization.
      // Without this, per-day caps fire 5-100x early on upto routes where
      // settle is typically << authorization.
      const settledHeader = res.headers.get(X_PAYMENT_SETTLED);
      const actualUsd = settledHeader ? microUsdcToUsd(settledHeader) : maxUsd;
      tracker.record(actualUsd);
      return (await res.json()) as T;
    },
  };
}
