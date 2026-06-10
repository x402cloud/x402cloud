# Vendored x402 proxy contracts (reference only)

Solidity source for the canonical x402 Permit2 proxy contracts, vendored
verbatim from [coinbase/x402](https://github.com/coinbase/x402)
(`contracts/evm/src`, fetched 2026-06-10, Apache-2.0 — see the upstream
repo's LICENSE and NOTICE). This directory is NOT a build target: the
contracts are already CREATE2-deployed at the same canonical address on
Base mainnet and Base Sepolia, and this repo only calls them.

| Contract | Canonical address (all chains via CREATE2) |
| --- | --- |
| `x402ExactPermit2Proxy` | `0x402085c248EeA27D92E8b30b2C58ed07f9E20001` |
| `x402UptoPermit2Proxy` | `0x4020A4f3b7b90ccA423B9fabCc0CE57C6C240002` |

These files exist so the ABIs and EIP-712 witness encodings in
`packages/evm/src/constants.ts` can be audited against the deployed
source without leaving the repo. To verify the deployed bytecode exposes
the `settle` ABI this repo calls, run the fail-closed gate:

```bash
pnpm -F x402cloud-scripts verify:mainnet
```

To deploy the same contracts at the same addresses on a new EVM chain
(anyone can, only gas required), follow the upstream
`contracts/evm/README.md` — both use Arachnid's deterministic CREATE2
deployer.
