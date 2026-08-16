import type { Network } from "@x402cloud/protocol";

/**
 * Casper CAIP-2 network identifiers.
 *
 * Casper uses its chain name (not a numeric id) as the CAIP-2 reference, so
 * mainnet is `casper:casper` and the public testnet is `casper:casper-test`.
 */
export const CASPER_MAINNET = "casper:casper" as const;
export const CASPER_TESTNET = "casper:casper-test" as const;

/** Every CAIP-2 network this package can service. */
export const CASPER_NETWORKS: readonly Network[] = Object.freeze([
  CASPER_MAINNET,
  CASPER_TESTNET,
]);

/**
 * Friendly chain name → CAIP-2 network identifier. Mirrors the EVM package's
 * `NETWORK_NAME_TO_CAIP2` so apps can resolve either family the same way.
 * Names are lowercase, hyphenated.
 */
export const NETWORK_NAME_TO_CAIP2: Readonly<Record<string, `casper:${string}`>> = Object.freeze({
  "casper": CASPER_MAINNET,
  "casper-mainnet": CASPER_MAINNET,
  "casper-test": CASPER_TESTNET,
  "casper-testnet": CASPER_TESTNET,
});

/** Resolve a name like "casper-test" to its CAIP-2 network. Throws on unknown. */
export function resolveNetwork(name: string): `casper:${string}` {
  const caip2 = NETWORK_NAME_TO_CAIP2[name];
  if (!caip2) {
    throw new Error(
      `Unknown network "${name}". Known: ${Object.keys(NETWORK_NAME_TO_CAIP2).join(", ")}`,
    );
  }
  return caip2;
}

/** The only scheme Casper settlement supports today. */
export const CASPER_SCHEME = "exact" as const;

/**
 * Hosted Casper x402 facilitator operated by CSPR.cloud. Verification and
 * settlement are delegated over HTTP — this package never holds a Casper
 * secret key. Override with `CASPER_FACILITATOR_URL`. Docs: docs.cspr.cloud.
 */
export const DEFAULT_FACILITATOR_URL = "https://x402-facilitator.cspr.cloud" as const;

/**
 * Bounded wall-clock for a single facilitator call. Kept well under the
 * orchestrator's in_flight lease for the same reason the EVM package bounds
 * its receipt wait: a hung settle must not outlive the lease and let a
 * concurrent attempt re-submit. Override with `CASPER_FACILITATOR_TIMEOUT_MS`.
 */
export const DEFAULT_FACILITATOR_TIMEOUT_MS = 60_000;

/**
 * wCSPR is a CEP-18 token with 9 decimals — one mote is 1e-9 CSPR and is the
 * smallest indivisible unit. All on-wire amounts are integer mote strings.
 */
export const MOTES_DECIMALS = 9;

/** 10 ** MOTES_DECIMALS, precomputed as a BigInt for mote conversions. */
export const MOTES_PER_CSPR = 1_000_000_000n;

/**
 * Default wCSPR CEP-18 contract hashes by CAIP-2 network.
 *
 * Empty by design: the canonical wCSPR hash differs per network and per
 * deployment, so operators supply it via `CASPER_WCSPR_CONTRACT` /
 * `CASPER_TESTNET_WCSPR_CONTRACT` (or explicit config). We deliberately do
 * not hard-code a hash we cannot verify from this repository — see
 * {@link wcsprContract}.
 */
export const DEFAULT_WCSPR_CONTRACTS: Readonly<Record<string, string>> = Object.freeze({});

/** Env var holding the wCSPR contract hash for each network. */
export const WCSPR_CONTRACT_ENV_VARS: Readonly<Record<string, string>> = Object.freeze({
  [CASPER_MAINNET]: "CASPER_WCSPR_CONTRACT",
  [CASPER_TESTNET]: "CASPER_TESTNET_WCSPR_CONTRACT",
});

/**
 * Resolve the wCSPR CEP-18 contract hash for a Casper network.
 *
 * Looks at the caller-supplied `env` bag first (defaults to `process.env`),
 * then the built-in defaults. Returns `undefined` when unconfigured; callers
 * MUST fail closed rather than settle against an unknown asset.
 */
export function wcsprContract(
  network: string,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const varName = WCSPR_CONTRACT_ENV_VARS[network];
  const fromEnv = varName ? env[varName] : undefined;
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_WCSPR_CONTRACTS[network];
}
