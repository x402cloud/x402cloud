# @x402cloud/evm

EVM payment scheme implementations for the x402 protocol. Supports both **exact** (fixed price) and **upto** (metered) payment schemes using Uniswap Permit2.

## Install

```bash
npm install @x402cloud/evm
```

## Usage

### Client: create a payment payload

```ts
import { createUptoPayload, createExactPayload } from "@x402cloud/evm";
import type { ClientSigner } from "@x402cloud/evm";
import type { PaymentRequirements } from "@x402cloud/protocol";

// Build a signer from a viem wallet
const signer: ClientSigner = {
  address: account.address,
  signTypedData: (params) => walletClient.signTypedData(params),
};

const requirements: PaymentRequirements = {
  scheme: "upto",
  network: "eip155:8453",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base
  maxAmount: "100000", // $0.10
  payTo: "0xRecipientAddress",
  maxTimeoutSeconds: 300,
};

// Signs a Permit2 authorization (no on-chain tx)
const payload = await createUptoPayload(signer, requirements);
```

### Server: verify and settle

```ts
import { verifyUpto, settleUpto } from "@x402cloud/evm";
import type { FacilitatorSigner, UptoPayload } from "@x402cloud/evm";

// Verify (read-only, no gas)
const result = await verifyUpto(signer, payload, requirements);
// { isValid: true, payer: "0x..." }

// Settle for actual usage (on-chain tx)
await settleUpto(signer, payload, requirements, "50000"); // settle for $0.05
```

### Constants

```ts
import {
  PERMIT2_ADDRESS,         // Canonical Permit2 address (all EVM chains)
  X402_UPTO_PROXY,         // x402 upto settlement proxy
  X402_EXACT_PROXY,        // x402 exact settlement proxy
  DEFAULT_USDC_ADDRESSES,  // USDC by network: { "eip155:8453": "0x833..." }
} from "@x402cloud/evm";
```

## Signer interfaces

The EVM package uses minimal signer interfaces so you can plug in any wallet:

- **`ClientSigner`** -- client-side, needs `address` + `signTypedData`
- **`VerifySigner`** -- read-only, needs `readContract` + `verifyTypedData`
- **`FacilitatorSigner`** -- extends VerifySigner with `writeContract` + `waitForTransactionReceipt`

## Exports

**Functions:** `createUptoPayload`, `verifyUpto`, `settleUpto`, `createExactPayload`, `verifyExact`, `settleExact`, `parseChainId`, `permit2Domain`

**Constants:** `PERMIT2_ADDRESS`, `X402_EXACT_PROXY`, `X402_UPTO_PROXY`, `DEFAULT_USDC_ADDRESSES`, `permit2WitnessTypes`, `erc20Abi`, `uptoProxyAbi`, `exactProxyAbi`

**Types:** `UptoPayload`, `ExactPayload`, `Permit2Witness`, `Permit2Authorization`, `ClientSigner`, `VerifySigner`, `FacilitatorSigner`

## Part of [x402cloud](https://github.com/x402cloud/x402cloud)
