# @x402cloud/protocol

x402 protocol types, header encoding/decoding, and USDC amount parsing. Zero dependencies.

## Install

```bash
npm install @x402cloud/protocol
```

## Usage

### Header encoding

```ts
import {
  encodePaymentHeader,
  decodePaymentHeader,
  encodeRequirementsHeader,
  decodeRequirementsHeader,
  extractPaymentHeader,
} from "@x402cloud/protocol";

// Encode a payment payload to base64 for the PAYMENT-SIGNATURE header
const encoded = encodePaymentHeader(payload);

// Decode from header value
const decoded = decodePaymentHeader(encoded);

// Extract payment header from a Request (supports v1 + v2 header names)
const header = extractPaymentHeader(request); // "PAYMENT-SIGNATURE" or "X-PAYMENT"
```

### USDC amount parsing

```ts
import { parseUsdcAmount, formatUsdcAmount } from "@x402cloud/protocol";

parseUsdcAmount("$0.10");  // "100000" (6 decimal places)
parseUsdcAmount("$1.00");  // "1000000"
formatUsdcAmount("100000"); // "$0.100000"
```

### Types

```ts
import type {
  Network,             // CAIP-2 identifier, e.g., "eip155:8453"
  Scheme,              // "exact" | "upto"
  PaymentRequirements, // What the server accepts
  PaymentRequired,     // 402 response envelope
  PaymentPayload,      // Client's payment proof
  ResourceInfo,        // Resource being paid for
  VerifyResponse,      // Facilitator verification result
  SettleResponse,      // Facilitator settlement result
  MeterFunction,       // Computes actual cost after request
  RouteConfig,         // Route configuration for middleware
  RoutesConfig,        // Map of route patterns to configs
} from "@x402cloud/protocol";
```

### Model registry

```ts
import { MODEL_REGISTRY, modelKeysOfType } from "@x402cloud/protocol";
import type { ModelType, ModelEntry, ModelKey } from "@x402cloud/protocol";

MODEL_REGISTRY.fast; // { cfModel: "@cf/meta/llama-4-scout...", type: "text", description: "Quick and capable" }
modelKeysOfType("text"); // ["nano", "fast", "smart", "think", "code", "big"]
```

## Exports

**Functions:** `encodePaymentHeader`, `decodePaymentHeader`, `encodeRequirementsHeader`, `decodeRequirementsHeader`, `extractPaymentHeader`, `parseUsdcAmount`, `formatUsdcAmount`, `modelKeysOfType`

**Constants:** `MODEL_REGISTRY`

**Types:** `Network`, `Scheme`, `PaymentRequirements`, `ResourceInfo`, `PaymentRequired`, `PaymentPayload`, `VerifyResponse`, `SettleResponse`, `MeterFunction`, `RouteConfig`, `RoutesConfig`, `ModelType`, `ModelEntry`, `ModelKey`

## Part of [x402cloud](https://github.com/x402cloud/x402cloud)
