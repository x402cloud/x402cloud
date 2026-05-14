import type { MarketplaceService } from "@x402cloud/protocol";
import { DEFAULT_MARGIN_BPS } from "@x402cloud/middleware";
import { retailDisplay } from "./format.js";
import { maxWholesaleCost } from "./scrape-pricing.js";
import type { ManifestParams, ServiceManifestEntry } from "./types.js";

type ScrapeRow = {
  /** Route path (without leading slash) */
  key: string;
  /** Catalog id */
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: MarketplaceService["examples"];
};

const SCRAPE_ROWS: ReadonlyArray<ScrapeRow> = Object.freeze([
  {
    key: "page",
    id: "scrape-page",
    name: "Web Page to Markdown",
    description: "Fetch a URL, render it with a headless browser, return clean markdown.",
    tags: ["scraping", "browser", "markdown", "web"],
    examples: [{
      description: "Scrape a page to markdown",
      request: { url: "https://example.com", waitFor: "networkidle" },
    }],
  },
  {
    key: "screenshot",
    id: "scrape-screenshot",
    name: "Page Screenshot",
    description: "Take a full-page PNG screenshot of any URL.",
    tags: ["scraping", "browser", "screenshot", "png"],
  },
]);

/**
 * Both scrape routes share the same worst-case wholesale (30s browser
 * time + per-request fee), so they share a single retail maxPrice string.
 */
function scrapeMaxPrice(marginBps: number): string {
  return retailDisplay(maxWholesaleCost(), marginBps);
}

export function scrapeManifest(p: ManifestParams): MarketplaceService[] {
  const marginBps = p.marginBps ?? DEFAULT_MARGIN_BPS;
  const maxPrice = scrapeMaxPrice(marginBps);
  return SCRAPE_ROWS.map((row) => ({
    id: row.id,
    category: "scraping" as const,
    name: row.name,
    description: row.description,
    endpoint: { method: "POST" as const, url: `${p.baseUrl}/${row.key}` },
    payment: {
      protocol: "x402" as const,
      scheme: "upto" as const,
      network: p.network,
      asset: p.asset,
      payTo: p.payTo,
      facilitator: p.facilitator,
      maxPrice,
      ...(p.marginBps !== undefined ? { marginBps: p.marginBps } : {}),
    },
    tags: row.tags,
    ...(row.examples ? { examples: row.examples } : {}),
  }));
}

export function scrapeEntries(p: ManifestParams): ServiceManifestEntry[] {
  const marginBps = p.marginBps ?? DEFAULT_MARGIN_BPS;
  const maxPrice = scrapeMaxPrice(marginBps);
  return SCRAPE_ROWS.map((row) => ({
    path: `/${row.key}`,
    id: row.id,
    maxPrice,
  }));
}
