# @x402cloud/casper

x402 payment support for the **Casper** network. Implements the `exact` scheme
over **wCSPR** (a CEP-18 token, 9 decimals) and delegates verification and
settlement to the hosted Casper x402 facilitator.

```bash
pnpm add @x402cloud/casper
```

## Why this package delegates

Casper settlement is deploy-based: submitting a wCSPR transfer requires a funded
Casper account and node access. Rather than embedding a Casper signer (and the
secret key that implies) in this monorepo, `@x402cloud/casper` speaks HTTP to a
facilitator that already holds those capabilities:

| Endpoint          | Purpose                                              |
| ----------------- | ---------------------------------------------------- |
| `POST /verify`    | Signature, balance, allowance and replay checks       |
| `POST /settle`    | Signs and submits the wCSPR CEP-18 deploy             |
| `GET  /supported` | Advertised `scheme` / `network` pairs                 |

**No Casper private key is read, stored, or required by this repository.**

## Networks

| CAIP-2               | Chain             |
| -------------------- | ----------------- |
| `casper:casper`      | Casper mainnet    |
| `casper:casper-test` | Casper testnet    |

## Configuration

| Variable                         | Default                                  | Purpose                                |
| -------------------------------- | ---------------------------------------- | -------------------------------------- |
| `CASPER_FACILITATOR_URL`         | `https://x402-facilitator.cspr.cloud`    | Facilitator base URL                   |
| `CASPER_FACILITATOR_TIMEOUT_MS`  | `60000`                                  | Bounded per-request wall-clock         |
| `CASPER_WCSPR_CONTRACT`          | —                                        | wCSPR CEP-18 hash on mainnet           |
| `CASPER_TESTNET_WCSPR_CONTRACT`  | —                                        | wCSPR CEP-18 hash on testnet           |

The wCSPR contract hash is intentionally not hard-coded — an operator supplies
the hash they have verified. When neither the payment requirements nor the
environment names an asset, verification and settlement fail closed with
`asset_not_configured`.

## Usage

```ts
import { createCasperSchemes } from "@x402cloud/casper";

const schemes = createCasperSchemes(); // reads CASPER_* from process.env

const result = await schemes.exact.verify(payload, requirements);
if (result.isValid) {
  const settled = await schemes.exact.settle(payload, requirements);
  // settled.transaction is the Casper deploy hash
}
```

The returned handlers match the `SchemeHandler` shape `@x402cloud/facilitator`
dispatches on, so a Casper network mounts alongside an EVM one without the
facilitator core learning anything chain-specific.

## Mote math

wCSPR has 9 decimals; one **mote** is the smallest indivisible unit and every
on-wire amount is an integer mote string. All arithmetic uses `BigInt`.

```ts
import { csprToMotes, formatMotes } from "@x402cloud/casper";

csprToMotes("1.25");        // 1250000000n
csprToMotes("0.0000000001"); // throws — sub-mote precision would be lost
formatMotes(1250000000n);    // "1.25"
```

`csprToMotes` **throws** rather than truncating. Silently dropping a digit would
desynchronise the charged amount from the signed authorization.

## Failing closed

Every infrastructure failure resolves to "not verified" / "not settled" — there
is no path where an unreachable facilitator yields a valid payment.

| Reason                            | Cause                                          |
| --------------------------------- | ---------------------------------------------- |
| `unsupported_network`             | `requirements.network` is not `casper:*`        |
| `unsupported_scheme`              | Scheme other than `exact`                       |
| `invalid_payload`                 | Payload failed structural validation            |
| `asset_not_configured`            | No wCSPR contract hash for this network         |
| `requirements_mismatch`           | Payload disagrees with the requirements         |
| `facilitator_timeout`             | Request exceeded the bounded timeout            |
| `facilitator_unreachable`         | DNS / TLS / socket failure                      |
| `facilitator_error`               | Facilitator answered non-2xx                    |
| `facilitator_malformed_response`  | 2xx with a body that cannot be trusted          |

A `success: true` settlement response without a deploy hash is treated as a
failure — reporting an unverifiable payment would release the resource for free.

## Scheme support

`exact` only. The `upto` scheme needs an on-chain partial-capture primitive that
the wCSPR CEP-18 flow does not provide, so advertising it would be a lie.

## License

MIT
