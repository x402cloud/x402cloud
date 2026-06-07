/**
 * Read-only verifier for the x402 Upto/Exact proxy contracts on Base MAINNET.
 *
 * Resolves docs/MAINNET-RUNBOOK.md §3a ("Blocker: Upto proxy contract source")
 * with one command instead of manual Basescan work. It answers, on-chain:
 *
 *   1. Does each candidate proxy address actually have bytecode on Base
 *      mainnet (chainId 8453)? (`eth_getCode`)
 *   2. Does that bytecode expose the EXACT `settle(...)` ABI this repo's
 *      `uptoProxyAbi` / `exactProxyAbi` calls? We confirm this by computing the
 *      4-byte function selector from the repo ABI and scanning the deployed
 *      runtime bytecode for the `PUSH4 <selector>` the Solidity dispatcher emits.
 *      If the address is an EIP-1167 minimal proxy we resolve the implementation
 *      and scan that. This is FAIL-CLOSED: only a positive selector match counts
 *      as confirmed — an opaque revert, no match, an RPC error, or a non-1167
 *      delegating proxy all read as INCONCLUSIVE → FAIL.
 *
 *      Why not infer from an `eth_call` revert? Because the EVM reverts with
 *      empty returndata for ANY unmatched selector, so "it reverted" cannot
 *      distinguish "function exists" from "wrong contract" — that approach gives
 *      a false PASS for any deployed-but-wrong address. We never gate on it.
 *   3. Does the mainnet candidate's bytecode differ from the Sepolia proxy
 *      this ABI was written against? (bytecode keccak prefix comparison)
 *   4. Do PERMIT2 and USDC(Base mainnet) have code? (sanity anchors)
 *
 * It is strictly READ-ONLY: no private key, no wallet, no writes, no
 * settlement — only `eth_getCode`.
 *
 * Usage:
 *   pnpm -F x402cloud-scripts verify:mainnet
 *   pnpm --dir scripts verify:mainnet
 *   BASE_MAINNET_RPC_URL=https://… pnpm -F x402cloud-scripts verify:mainnet
 *
 * Env:
 *   BASE_MAINNET_RPC_URL   Base mainnet RPC (default https://mainnet.base.org)
 *
 * Optional CLI overrides (defaults are the runbook §3a candidate addresses):
 *   --upto-mainnet=0x…     mainnet candidate for the Upto proxy
 *   --exact-mainnet=0x…    mainnet candidate for the Exact proxy
 *   --upto-sepolia=0x…     Sepolia reference (defaults to repo X402_UPTO_PROXY)
 *   --exact-sepolia=0x…    Sepolia reference (defaults to repo X402_EXACT_PROXY)
 *   --sepolia-rpc=https://…  Sepolia RPC for the bytecode diff (default base.org)
 *
 * Exit code is 0 only when mainnet settlement looks safe (both proxies have
 * code AND match our ABI on at least one resolved address); non-zero otherwise.
 */

import {
  createPublicClient,
  http,
  keccak256,
  toFunctionSelector,
  type Address,
  type Abi,
  type AbiFunction,
  type Hex,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import {
  PERMIT2_ADDRESS,
  X402_UPTO_PROXY,
  X402_EXACT_PROXY,
  DEFAULT_USDC_ADDRESSES,
  uptoProxyAbi,
  exactProxyAbi,
} from "@x402cloud/evm";

const DEFAULT_MAINNET_RPC = "https://mainnet.base.org";
const DEFAULT_SEPOLIA_RPC = "https://sepolia.base.org";

/**
 * Narrow read-only RPC port — the only two methods this script needs.
 *
 * Annotating helpers with this structural type (rather than viem's
 * chain-parameterised `PublicClient`) keeps `base` and `baseSepolia` clients
 * assignable without their divergent `getBlock` transaction unions clashing,
 * and documents that this tool only ever *reads* (Hickey: require less).
 */
type ReadClient = {
  getCode(args: { address: Address }): Promise<Hex | undefined>;
};

/**
 * Coinbase canonical CREATE2 mainnet proxy candidates surfaced in
 * packages/evm/src/constants.ts (PROXY_ADDRESSES doc comment) and the runbook.
 * Treated as DEFAULTS only — overridable via CLI so this stays data, not dogma.
 */
const MAINNET_CANDIDATES = {
  upto: "0x4020A4f3b7b90ccA423B9fabCc0CE57C6C240002" as Address,
  exact: "0x402085c248EeA27D92E8b30b2C58ed07f9E20001" as Address,
} as const;

const BASE_MAINNET_USDC = DEFAULT_USDC_ADDRESSES["eip155:8453"] as Address;

type Cli = {
  uptoMainnet: Address;
  exactMainnet: Address;
  uptoSepolia: Address;
  exactSepolia: Address;
  mainnetRpc: string;
  sepoliaRpc: string;
};

function isAddress(v: string): v is Address {
  return /^0x[0-9a-fA-F]{40}$/.test(v);
}

function readAddrArg(argv: readonly string[], flag: string, fallback: Address): Address {
  const arg = argv.find((a) => a.startsWith(`${flag}=`));
  if (!arg) return fallback;
  const value = arg.slice(flag.length + 1);
  if (!isAddress(value)) throw new Error(`${flag} must be a 0x 20-byte address, got: ${value}`);
  return value;
}

function readStrArg(argv: readonly string[], flag: string, fallback: string): string {
  const arg = argv.find((a) => a.startsWith(`${flag}=`));
  return arg ? arg.slice(flag.length + 1) : fallback;
}

function parseArgs(argv: readonly string[]): Cli {
  return {
    uptoMainnet: readAddrArg(argv, "--upto-mainnet", MAINNET_CANDIDATES.upto),
    exactMainnet: readAddrArg(argv, "--exact-mainnet", MAINNET_CANDIDATES.exact),
    uptoSepolia: readAddrArg(argv, "--upto-sepolia", X402_UPTO_PROXY as Address),
    exactSepolia: readAddrArg(argv, "--exact-sepolia", X402_EXACT_PROXY as Address),
    mainnetRpc: readStrArg(
      argv,
      "--mainnet-rpc",
      process.env.BASE_MAINNET_RPC_URL ?? DEFAULT_MAINNET_RPC,
    ),
    sepoliaRpc: readStrArg(argv, "--sepolia-rpc", DEFAULT_SEPOLIA_RPC),
  };
}

/** `getCode` returns `undefined` or `0x` when an address has no contract. */
async function hasCode(client: ReadClient, address: Address): Promise<{ ok: boolean; codeHashPrefix: string }> {
  const code = await client.getCode({ address });
  if (!code || code === "0x") return { ok: false, codeHashPrefix: "—" };
  return { ok: true, codeHashPrefix: keccak256(code).slice(0, 18) };
}

function trim(s: string): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > 120 ? `${oneLine.slice(0, 117)}...` : oneLine;
}

/**
 * Result of checking whether a deployed contract exposes our settle() selector.
 * FAIL-CLOSED: only "confirmed" is a positive ABI match. Everything else
 * (selector absent, no code, an RPC error, or a delegating proxy we cannot
 * resolve) is treated as NOT safe by the verdict.
 */
type AbiCheck = "confirmed" | "not-found" | "no-code" | "rpc-error";
type AbiProbe = { abiMatch: AbiCheck; how: string };

/** The canonical 4-byte selector of settle(...) for the given repo ABI. */
function settleSelector(abi: Abi): Hex {
  const item = abi.find(
    (x): x is AbiFunction => x.type === "function" && x.name === "settle",
  );
  if (!item) throw new Error("settle() not found in the provided ABI");
  return toFunctionSelector(item);
}

/**
 * Does the runtime bytecode dispatch on this selector? Solidity emits
 * `PUSH4 <selector>` (opcode 0x63 + the 4 selector bytes) for each external
 * function, so the presence of `63<selector>` is strong positive evidence the
 * function exists with exactly our signature. We require the PUSH4 form (not the
 * bare 4 bytes, which could collide) — fail-closed.
 */
function bytecodeHasSelector(code: Hex, selector: Hex): boolean {
  const hay = code.toLowerCase();
  const needle = `63${selector.slice(2).toLowerCase()}`;
  return hay.includes(needle);
}

/**
 * If `code` is an EIP-1167 minimal proxy, return the implementation address it
 * delegatecalls to (classic and PUSH0 variants); otherwise null. Lets us resolve
 * the real implementation before scanning for the selector.
 */
function eip1167Impl(code: Hex): Address | null {
  const c = code.toLowerCase().replace(/^0x/, "");
  // classic: 363d3d373d3d3d363d73 <20-byte impl> 5af43d82803e903d91602b57fd5bf3
  const classic = c.match(/363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3/);
  if (classic) return `0x${classic[1]}` as Address;
  // PUSH0 (0x5f) variant emitted by newer toolchains
  const push0 = c.match(/365f5f375f5f365f73([0-9a-f]{40})5af43d5f5f3e5f3d91602a57fd5bf3/);
  if (push0) return `0x${push0[1]}` as Address;
  return null;
}

/**
 * Confirm a proxy exposes our settle() selector by scanning deployed bytecode
 * (resolving an EIP-1167 minimal proxy to its implementation if needed). This is
 * sound where eth_call revert-classification is not: the EVM reverts with empty
 * returndata for ANY unmatched selector, so a revert cannot prove a function
 * exists. A selector in the dispatcher can.
 */
async function probeSettle(
  client: ReadClient,
  address: Address,
  abi: Abi,
): Promise<AbiProbe> {
  const selector = settleSelector(abi);
  let code: Hex | undefined;
  try {
    code = await client.getCode({ address });
  } catch (err) {
    return { abiMatch: "rpc-error", how: `RPC error (inconclusive): ${trim(String(err))}` };
  }
  if (!code || code === "0x") return { abiMatch: "no-code", how: "no bytecode at address" };

  if (bytecodeHasSelector(code, selector)) {
    return { abiMatch: "confirmed", how: `settle() selector ${selector} found in bytecode (PUSH4 dispatch)` };
  }

  const impl = eip1167Impl(code);
  if (impl) {
    let implCode: Hex | undefined;
    try {
      implCode = await client.getCode({ address: impl });
    } catch (err) {
      return { abiMatch: "rpc-error", how: `EIP-1167 impl ${impl} getCode failed: ${trim(String(err))}` };
    }
    if (implCode && implCode !== "0x" && bytecodeHasSelector(implCode, selector)) {
      return { abiMatch: "confirmed", how: `selector ${selector} found via EIP-1167 implementation ${impl}` };
    }
    return { abiMatch: "not-found", how: `EIP-1167 proxy → impl ${impl} does NOT expose selector ${selector}` };
  }

  return {
    abiMatch: "not-found",
    how: `selector ${selector} NOT in bytecode (wrong contract, or a non-1167 delegating proxy — verify the implementation manually)`,
  };
}

type ContractReport = {
  label: string;
  address: Address;
  hasCode: boolean;
  codeHashPrefix: string;
  abiMatch: AbiCheck | "n/a";
  abiHow: string;
};

async function reportProxy(
  client: ReadClient,
  label: string,
  address: Address,
  abi: Abi,
): Promise<ContractReport> {
  const code = await hasCode(client, address);
  const probe = await probeSettle(client, address, abi);
  return {
    label,
    address,
    hasCode: code.ok,
    codeHashPrefix: code.codeHashPrefix,
    abiMatch: probe.abiMatch,
    abiHow: probe.how,
  };
}

async function reportAnchor(
  client: ReadClient,
  label: string,
  address: Address,
): Promise<ContractReport> {
  const code = await hasCode(client, address);
  return {
    label,
    address,
    hasCode: code.ok,
    codeHashPrefix: code.codeHashPrefix,
    abiMatch: "n/a",
    abiHow: code.ok ? "has code" : "NO CODE",
  };
}

function printReport(r: ContractReport): void {
  const codeTag = r.hasCode ? "code" : "NO-CODE";
  const abiTag =
    r.abiMatch === "n/a" || r.abiMatch === "no-code"
      ? "—"
      : r.abiMatch === "confirmed"
        ? "ABI-OK"
        : r.abiMatch === "not-found"
          ? "ABI-MISMATCH"
          : "INCONCLUSIVE";
  console.log(`  ${r.label.padEnd(26)} ${r.address}`);
  console.log(
    `      hasCode=${codeTag.padEnd(7)} abi=${abiTag.padEnd(12)} hash=${r.codeHashPrefix}`,
  );
  console.log(`      ${r.abiHow}`);
}

async function main(): Promise<number> {
  const cli = parseArgs(process.argv.slice(2));

  const mainnet = createPublicClient({ chain: base, transport: http(cli.mainnetRpc) });
  const sepolia = createPublicClient({ chain: baseSepolia, transport: http(cli.sepoliaRpc) });

  console.log("x402 mainnet proxy verifier — READ-ONLY (no key, no settlement)");
  console.log(`Base mainnet RPC : ${cli.mainnetRpc}`);
  console.log(`Base sepolia RPC : ${cli.sepoliaRpc} (bytecode-diff reference)\n`);

  // --- Sepolia reference bytecode (the ABI was written against these) ---
  console.log("Sepolia reference proxies (source-of-truth ABI):");
  let sepoliaUptoHash = "—";
  let sepoliaExactHash = "—";
  try {
    const su = await hasCode(sepolia, cli.uptoSepolia);
    const se = await hasCode(sepolia, cli.exactSepolia);
    sepoliaUptoHash = su.codeHashPrefix;
    sepoliaExactHash = se.codeHashPrefix;
    console.log(`  upto  ${cli.uptoSepolia} hasCode=${su.ok} hash=${su.codeHashPrefix}`);
    console.log(`  exact ${cli.exactSepolia} hasCode=${se.ok} hash=${se.codeHashPrefix}\n`);
  } catch (err) {
    console.log(`  (sepolia RPC unavailable — bytecode diff skipped): ${trim(String(err))}\n`);
  }

  // --- Mainnet proxies ---
  const reports: ContractReport[] = [];

  console.log("Base MAINNET — repo Sepolia addresses (legacy constants):");
  const uptoLegacy = await reportProxy(mainnet, "upto (repo Sepolia addr)", cli.uptoSepolia, uptoProxyAbi as Abi);
  const exactLegacy = await reportProxy(mainnet, "exact (repo Sepolia addr)", cli.exactSepolia, exactProxyAbi as Abi);
  printReport(uptoLegacy);
  printReport(exactLegacy);
  reports.push(uptoLegacy, exactLegacy);

  console.log("\nBase MAINNET — Coinbase CREATE2 candidates (runbook §3a):");
  const uptoCand = await reportProxy(mainnet, "upto (mainnet candidate)", cli.uptoMainnet, uptoProxyAbi as Abi);
  const exactCand = await reportProxy(mainnet, "exact (mainnet candidate)", cli.exactMainnet, exactProxyAbi as Abi);
  printReport(uptoCand);
  printReport(exactCand);
  reports.push(uptoCand, exactCand);

  // --- Bytecode-diff flags vs Sepolia source-of-truth ---
  console.log("\nBytecode comparison vs Sepolia reference:");
  flagDiff("upto candidate", uptoCand, sepoliaUptoHash);
  flagDiff("exact candidate", exactCand, sepoliaExactHash);

  // --- Sanity anchors ---
  console.log("\nSanity anchors (must have code on mainnet):");
  const permit2 = await reportAnchor(mainnet, "Permit2", PERMIT2_ADDRESS as Address);
  const usdc = await reportAnchor(mainnet, "USDC (Base)", BASE_MAINNET_USDC);
  printReport(permit2);
  printReport(usdc);
  reports.push(permit2, usdc);

  return verdict(uptoCand, exactCand, uptoLegacy, exactLegacy, permit2, usdc);
}

function flagDiff(label: string, candidate: ContractReport, sepoliaHash: string): void {
  if (!candidate.hasCode) {
    console.log(`  ${label}: no mainnet code — nothing to compare`);
    return;
  }
  if (sepoliaHash === "—") {
    console.log(`  ${label}: sepolia reference unavailable — cannot compare`);
    return;
  }
  const same = candidate.codeHashPrefix === sepoliaHash;
  console.log(
    `  ${label}: mainnet=${candidate.codeHashPrefix} sepolia=${sepoliaHash} → ${
      same ? "IDENTICAL bytecode" : "DIFFERENT bytecode (expected for CREATE2 variants; rely on ABI probe)"
    }`,
  );
}

/**
 * A proxy is "settle-safe" only on a POSITIVE selector confirmation. Fail-closed:
 * not-found, no-code, rpc-error and n/a all read as unsafe — never gate a
 * real-USDC deploy on the absence of disconfirmation.
 */
function isSettleSafe(r: ContractReport): boolean {
  return r.hasCode && r.abiMatch === "confirmed";
}

function pickSafeAddress(
  candidate: ContractReport,
  legacy: ContractReport,
): { safe: boolean; addr: Address | null } {
  if (isSettleSafe(candidate)) return { safe: true, addr: candidate.address };
  if (isSettleSafe(legacy)) return { safe: true, addr: legacy.address };
  return { safe: false, addr: null };
}

function verdict(
  uptoCand: ContractReport,
  exactCand: ContractReport,
  uptoLegacy: ContractReport,
  exactLegacy: ContractReport,
  permit2: ContractReport,
  usdc: ContractReport,
): number {
  const upto = pickSafeAddress(uptoCand, uptoLegacy);
  const exact = pickSafeAddress(exactCand, exactLegacy);
  const anchorsOk = permit2.hasCode && usdc.hasCode;

  console.log("\n========================= VERDICT =========================");
  console.log(`  Upto  proxy : ${upto.safe ? `PASS → ${upto.addr}` : "FAIL — no address has code + matching settle() ABI"}`);
  console.log(`  Exact proxy : ${exact.safe ? `PASS → ${exact.addr}` : "FAIL — no address has code + matching settle() ABI"}`);
  console.log(`  Permit2     : ${permit2.hasCode ? "PASS" : "FAIL — no code on mainnet"}`);
  console.log(`  USDC (Base) : ${usdc.hasCode ? "PASS" : "FAIL — no code on mainnet"}`);

  const overall = upto.safe && exact.safe && anchorsOk;
  console.log("  -----------------------------------------------------------");
  if (overall) {
    console.log("  OVERALL: PASS — mainnet settlement looks safe with the current ABI.");
    console.log(`    Wire PROXY_ADDRESSES['eip155:8453'] = { upto: ${upto.addr}, exact: ${exact.addr} }`);
    console.log("    (edit packages/evm/src/constants.ts — out of this script's scope).");
  } else {
    console.log("  OVERALL: FAIL — do NOT enable mainnet settlement yet. See per-contract lines above.");
    console.log("    Runbook §3a remains a blocker until both proxies PASS.");
  }
  console.log("===========================================================");

  return overall ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
