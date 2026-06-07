import type { MarketplaceService } from "@x402cloud/protocol";
import { DEFAULT_MARGIN_BPS } from "@x402cloud/middleware";
import { retailDisplay } from "./format.js";
import { maxWholesaleCost } from "./sandbox-pricing.js";
import type { ManifestParams, ServiceManifestEntry } from "./types.js";

type SandboxRow = {
  /** Route path (without leading slash) */
  key: string;
  /** Catalog id */
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: MarketplaceService["examples"];
};

const SANDBOX_ROWS: ReadonlyArray<SandboxRow> = Object.freeze([
  {
    key: "python",
    id: "sandbox-python",
    name: "Python Sandbox",
    description: "Run Python code in an isolated sandbox. Returns stdout, stderr, exit code.",
    tags: ["sandbox", "python", "code-execution"],
    examples: [{
      description: "Run a simple script",
      request: { code: "print(sum(range(100)))", timeout: 5000 },
    }],
  },
  {
    key: "node",
    id: "sandbox-node",
    name: "Node.js Sandbox",
    description: "Run JavaScript/TypeScript in an isolated sandbox.",
    tags: ["sandbox", "javascript", "typescript", "code-execution"],
  },
]);

/**
 * All sandbox runtimes share the same worst-case wholesale (30s container
 * time), so they share a single retail maxPrice string.
 */
function sandboxMaxPrice(marginBps: number): string {
  return retailDisplay(maxWholesaleCost(), marginBps);
}

export function sandboxManifest(p: ManifestParams): MarketplaceService[] {
  const marginBps = p.marginBps ?? DEFAULT_MARGIN_BPS;
  const maxPrice = sandboxMaxPrice(marginBps);
  return SANDBOX_ROWS.map((row) => ({
    id: row.id,
    category: "sandbox" as const,
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

export function sandboxEntries(p: ManifestParams): ServiceManifestEntry[] {
  const marginBps = p.marginBps ?? DEFAULT_MARGIN_BPS;
  const maxPrice = sandboxMaxPrice(marginBps);
  return SANDBOX_ROWS.map((row) => ({
    path: `/${row.key}`,
    id: row.id,
    maxPrice,
  }));
}
