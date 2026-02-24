# @x402cloud/client

Client SDK that auto-pays x402 (HTTP 402) responses. Wraps `fetch` to transparently handle payment negotiation -- your code makes normal HTTP requests and the SDK handles signing and retrying.

## Install

```bash
npm install @x402cloud/client
```

## Usage

```ts
import { wrapFetchWithPayment } from "@x402cloud/client";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

// Set up a viem wallet
const account = privateKeyToAccount("0xYourPrivateKey");
const wallet = createWalletClient({ account, chain: base, transport: http() });

// Wrap fetch with auto-payment
const payingFetch = wrapFetchWithPayment({
  signer: {
    address: account.address,
    signTypedData: (params) => wallet.signTypedData(params),
  },
});

// Use it like normal fetch -- 402s are handled automatically
const response = await payingFetch("https://infer.x402cloud.ai/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    messages: [{ role: "user", content: "Hello" }],
  }),
});

const data = await response.json();
```

## How it works

1. Your code calls `payingFetch(url, options)` like normal `fetch`
2. If the server returns `402 Payment Required`, the SDK:
   - Parses the payment requirements from the response
   - Signs a Permit2 authorization using your wallet (no on-chain tx)
   - Retries the request with a `PAYMENT-SIGNATURE` header
3. You get back the final response

Supports both `upto` (metered) and `exact` (fixed) payment schemes out of the box.

## Configuration

```ts
const payingFetch = wrapFetchWithPayment({
  signer: { address, signTypedData },  // Required: wallet signer
  maxRetries: 1,                        // Optional: retry count (default: 1)
  schemeHandlers: { /* ... */ },        // Optional: custom scheme handlers
});
```

## Exports

**Functions:** `wrapFetchWithPayment`

**Types:** `PaymentClientConfig`, `SchemeHandler`

## Part of [x402cloud](https://github.com/x402cloud/x402cloud)
