/**
 * Gas-unit re-measurement (workspace#45) — the CI assertion that
 * `@x402cloud/facilitator`'s `SETTLE_GAS_UNITS` table (an engineering
 * estimate, see fee.ts's status note) still matches reality.
 *
 * Runs a REAL settleUpto and settleExact against an Anvil fork of Base
 * Sepolia (same rig as payment-flow.test.ts — no faucets, deterministic,
 * instant), reads each transaction's ACTUAL `gasUsed` from its receipt, and
 * fails the build if it drifts outside a documented tolerance band of the
 * checked-in constant. This is the guard workspace#45 asks for: a change to
 * the proxy contracts, Permit2, or the settle encoding shows up here as a
 * failing test rather than a silently wrong (and silently under-charging)
 * fee floor.
 *
 * Requires: anvil (Foundry) — see payment-flow.test.ts's header. This suite
 * is NOT run by the PR CI gate (`.github/workflows/ci.yml`'s `build-and-test`
 * job runs unit tests only, `--filter='!e2e-tests'`); it runs in the `e2e`
 * job on push to main, alongside the rest of tests/e2e.
 *
 * If this test fails: re-measure `SETTLE_GAS_UNITS` in
 * `packages/facilitator/src/fee.ts` from the receipts this test prints, and
 * widen/narrow GAS_UNITS_TOLERANCE only with a documented reason — it exists
 * to absorb minor Permit2/proxy-internal variance, not to paper over a real
 * drift the fee floor needs to track.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  maxUint256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { spawn, type ChildProcess, execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

import { createFacilitator } from "@x402cloud/facilitator";
import { SETTLE_GAS_UNITS } from "@x402cloud/facilitator";
import {
  createUptoPayload,
  createExactPayload,
  DEFAULT_USDC_ADDRESSES,
  PERMIT2_ADDRESS,
  erc20Abi,
} from "@x402cloud/evm";
import type { PaymentRequirements } from "@x402cloud/protocol";

const NETWORK = "eip155:84532" as const;
const USDC = DEFAULT_USDC_ADDRESSES[NETWORK];
const PAY_TO = "0x207C6D8f63Bf01F70dc6D372693E8D5943848E88";
const RPC_URL = process.env.RPC_URL ?? "https://sepolia.base.org";
const ANVIL_PORT = 8547; // distinct from payment-flow.test.ts's 8546 — both suites may run in the same job
const ANVIL_RPC = `http://127.0.0.1:${ANVIL_PORT}`;

// Fresh, non-well-known keys — see payment-flow.test.ts for why (EIP-7702
// delegation on the well-known Anvil accounts breaks the Permit2 ECDSA path).
const CUSTOMER_KEY = "0x3333333333333333333333333333333333333333333333333333333333333333" as const;
const FACILITATOR_KEY = "0x4444444444444444444444444444444444444444444444444444444444444444" as const;

/**
 * How far actual gasUsed may drift from the checked-in SETTLE_GAS_UNITS
 * before this test fails the build. Wide enough to absorb Permit2's own
 * minor state-dependent variance (warm vs cold storage slots); anything
 * outside it means the checked-in estimate no longer reflects the deployed
 * contracts and must be corrected, not ignored.
 */
const GAS_UNITS_TOLERANCE = 0.35;

const transferAbi = [
  {
    name: "transfer", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    name: "approve", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  ...erc20Abi,
] as const;

function findAnvil(): string {
  try {
    return execSync("which anvil", { encoding: "utf-8" }).trim();
  } catch {}
  const foundryBin = join(homedir(), ".foundry", "bin", "anvil");
  if (existsSync(foundryBin)) return foundryBin;
  throw new Error("anvil not found. Install Foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup");
}

function startAnvil(): Promise<ChildProcess> {
  const anvilBin = findAnvil();
  return new Promise((resolve, reject) => {
    const proc = spawn(anvilBin, ["--fork-url", RPC_URL, "--port", String(ANVIL_PORT), "--silent"], { stdio: "pipe" });
    const timeout = setTimeout(() => reject(new Error("Anvil startup timeout")), 15000);
    const onReady = (data: Buffer) => {
      if (data.toString().includes("Listening on")) {
        clearTimeout(timeout);
        resolve(proc);
      }
    };
    proc.stdout?.on("data", onReady);
    proc.stderr?.on("data", onReady);
    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    setTimeout(() => {
      clearTimeout(timeout);
      resolve(proc);
    }, 3000);
  });
}

describe("SETTLE_GAS_UNITS re-measurement (Anvil fork of Base Sepolia, workspace#45)", () => {
  let anvil: ChildProcess;
  let customerAccount: ReturnType<typeof privateKeyToAccount>;
  let facilitatorAccount: ReturnType<typeof privateKeyToAccount>;

  beforeAll(async () => {
    anvil = await startAnvil();

    customerAccount = privateKeyToAccount(CUSTOMER_KEY);
    facilitatorAccount = privateKeyToAccount(FACILITATOR_KEY);

    for (const addr of [customerAccount.address, facilitatorAccount.address]) {
      await fetch(ANVIL_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "anvil_setBalance", params: [addr, "0x21E19E0C9BAB2400000"], id: 1 }),
      });
    }

    const publicClient = createPublicClient({ chain: baseSepolia, transport: http(ANVIL_RPC) });

    // Fund the customer with USDC directly via storage (same technique as
    // payment-flow.test.ts — no faucet, deterministic).
    const usdcAmount = parseUnits("100", 6);
    const { keccak256, encodePacked, toHex, pad } = await import("viem");
    for (let slot = 0; slot <= 15; slot++) {
      const s = keccak256(encodePacked(["bytes32", "bytes32"], [pad(customerAccount.address, { size: 32 }), pad(toHex(slot), { size: 32 })]));
      await fetch(ANVIL_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "anvil_setStorageAt", params: [USDC, s, pad(toHex(usdcAmount), { size: 32 })], id: 1 }),
      });
      const b = (await publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [customerAccount.address] })) as bigint;
      if (b > 0n) break;
    }

    const customerWallet = createWalletClient({ chain: baseSepolia, transport: http(ANVIL_RPC), account: customerAccount });
    await customerWallet.writeContract({ address: USDC, abi: transferAbi, functionName: "approve", args: [PERMIT2_ADDRESS, maxUint256] });
  }, 30_000);

  afterAll(() => {
    anvil?.kill();
  });

  async function measureGasUsed(scheme: "upto" | "exact"): Promise<bigint> {
    const facilitator = createFacilitator({
      privateKey: FACILITATOR_KEY,
      rpcUrl: ANVIL_RPC,
      network: NETWORK,
      chain: baseSepolia,
    });

    const requirements: PaymentRequirements = {
      scheme,
      network: NETWORK,
      asset: USDC,
      maxAmount: parseUnits("0.01", 6).toString(),
      payTo: PAY_TO,
      maxTimeoutSeconds: 300,
      extra: { facilitator: facilitator.address },
    };

    const clientSigner = {
      address: customerAccount.address,
      signTypedData: (params: unknown) => customerAccount.signTypedData(params as never),
    };

    const result = await (scheme === "upto"
      ? (async () => {
          const payload = await createUptoPayload(clientSigner, requirements);
          return facilitator.settle(payload, requirements, requirements.maxAmount);
        })()
      : (async () => {
          const payload = await createExactPayload(clientSigner, requirements);
          return facilitator.settleExact(payload, requirements);
        })());

    if (!result.success) {
      throw new Error(`${scheme} settle failed: ${result.errorReason}`);
    }

    const publicClient = createPublicClient({ chain: baseSepolia, transport: http(ANVIL_RPC) });
    const receipt = await publicClient.getTransactionReceipt({ hash: result.transaction as `0x${string}` });
    return receipt.gasUsed;
  }

  it("upto settle's real gasUsed is within tolerance of the checked-in SETTLE_GAS_UNITS", async () => {
    const measured = await measureGasUsed("upto");
    const baseline = SETTLE_GAS_UNITS[`upto:${NETWORK}`];
    console.log(`[gas-measurement] upto:${NETWORK} measured=${measured} baseline=${baseline}`);

    const lower = (baseline * BigInt(Math.round((1 - GAS_UNITS_TOLERANCE) * 1000))) / 1000n;
    const upper = (baseline * BigInt(Math.round((1 + GAS_UNITS_TOLERANCE) * 1000))) / 1000n;
    expect(measured >= lower && measured <= upper).toBe(true);
  }, 60_000);

  it("exact settle's real gasUsed is within tolerance of the checked-in SETTLE_GAS_UNITS", async () => {
    const measured = await measureGasUsed("exact");
    const baseline = SETTLE_GAS_UNITS[`exact:${NETWORK}`];
    console.log(`[gas-measurement] exact:${NETWORK} measured=${measured} baseline=${baseline}`);

    const lower = (baseline * BigInt(Math.round((1 - GAS_UNITS_TOLERANCE) * 1000))) / 1000n;
    const upper = (baseline * BigInt(Math.round((1 + GAS_UNITS_TOLERANCE) * 1000))) / 1000n;
    expect(measured >= lower && measured <= upper).toBe(true);
  }, 60_000);
});
