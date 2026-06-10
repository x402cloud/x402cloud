# @x402cloud/manifests

Single source of truth for x402cloud service manifests — what services exist and how they're priced. Consumed by both the marketplace catalog and each service Worker, so prices never drift between the catalog and the route table.

Publishable workspace package (`publishConfig.access: "public"`), though it is primarily internal plumbing for the x402cloud services (infer, sandbox, scrape) — most integrators won't need it directly.

## Install

```bash
pnpm add @x402cloud/manifests
```

## Usage

### Build catalog entries + route tables

Each service has a manifest builder. The caller supplies only the **environmental** values (network, wallet, URLs); all prices are derived from the module's own wholesale-cost math:

```ts
import { inferManifest, inferEntries } from "@x402cloud/manifests";
import type { ManifestParams } from "@x402cloud/manifests";

const params: ManifestParams = {
  network: "eip155:84532",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // USDC on Base Sepolia
  payTo: "0xOperatorWallet",
  facilitator: "https://facilitator.x402cloud.ai",
  baseUrl: "https://infer.x402cloud.ai",
};

// Full MarketplaceService[] for the catalog
const services = inferManifest(params);

// Lightweight { path, id, maxPrice }[] for the service's own route table
const entries = inferEntries();
```

`sandboxManifest`/`sandboxEntries` and `scrapeManifest`/`scrapeEntries` work the same way.

### Wholesale pricing helpers

```ts
import {
  wholesaleTextCost,
  wholesaleEmbedCost,
  wholesaleImageCost,
  INFER_NEURONS,
  MICRO_USDC_PER_NEURON,
  sandboxPricing,
  scrapePricing,
} from "@x402cloud/manifests";

// Micro-USDC wholesale cost for a metered inference call
const micro = wholesaleTextCost(INFER_NEURONS.fast, 500, 2000); // 500 in + 2000 out tokens

// Duration-based services (namespaced to avoid name collisions)
sandboxPricing.wholesaleForDurationMs(12_000);
scrapePricing.maxWholesaleCost();
```

### Display formatting

```ts
import { microToUsdDisplay, retailDisplay } from "@x402cloud/manifests";

microToUsdDisplay("5000");  // "$0.005000"
retailDisplay("5000");       // wholesale + marketplace margin, as "$X.XXXXXX"
```

Adding a model or service is a data change (a new neuron-rate row or manifest module), not a code change — the catalog and route tables regenerate from the same source.

## Exports

**Manifests:** `inferManifest`, `inferEntries`, `sandboxManifest`, `sandboxEntries`, `scrapeManifest`, `scrapeEntries`

**Pricing:** `INFER_NEURONS`, `MICRO_USDC_PER_NEURON`, `IMAGE_NEURONS_PER_GEN`, `IMAGE_NEURONS_PER_GEN_SCALED_10`, `wholesaleTextCost`, `wholesaleEmbedCost`, `wholesaleImageCost`, `sandboxPricing` (namespace), `scrapePricing` (namespace)

**Formatting:** `retailDisplay`, `microToUsdDisplay`

**Types:** `ManifestParams`, `ServiceManifestEntry`, `NeuronRate`

Subpath exports are also available: `@x402cloud/manifests/infer-pricing`, `/sandbox-pricing`, `/scrape-pricing`.

## License

MIT — part of [x402cloud](https://github.com/x402cloud/x402cloud)
