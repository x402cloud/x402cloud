import type { Catalog, MarketplaceService } from "@x402cloud/protocol";
import type { DiscoverFilter } from "./types.js";

/**
 * Fetch the marketplace catalog, optionally filtered.
 *
 * Hits `GET /services` on the catalog URL. The marketplace server applies the
 * filter server-side via query params.
 */
export async function fetchCatalog(
  catalogUrl: string,
  filter?: DiscoverFilter,
  fetchImpl: typeof fetch = fetch,
): Promise<MarketplaceService[]> {
  const url = new URL("/services", catalogUrl);
  if (filter?.category) url.searchParams.set("category", filter.category);
  if (filter?.tag) url.searchParams.set("tag", filter.tag);
  if (filter?.q) url.searchParams.set("q", filter.q);

  const res = await fetchImpl(url.toString());
  if (!res.ok) {
    throw new Error(`Catalog fetch failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as Catalog;
  return body.services;
}

/**
 * Fetch a single service by id. Returns `null` on 404, throws on other errors.
 */
export async function fetchService(
  catalogUrl: string,
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MarketplaceService | null> {
  const url = new URL(`/services/${encodeURIComponent(id)}`, catalogUrl);
  const res = await fetchImpl(url.toString());
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Service fetch failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as MarketplaceService;
}
