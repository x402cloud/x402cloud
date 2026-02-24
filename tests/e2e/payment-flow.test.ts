/**
 * End-to-end x402 payment flow test using Anvil (local fork of Base Sepolia).
 *
 * No faucets. No external dependencies. Deterministic. Instant.
 *
 * Anvil forks Base Sepolia so Permit2, Upto Proxy, and USDC contracts exist.
 * We impersonate a USDC-rich account and fund our test wallets locally.
 *
 * Requires: anvil (from Foundry) installed — `curl -L https://foundry.paradigm.xyz | bash && foundryup`
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
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

import { uptoPaymentMiddleware } from "@x402cloud/middleware";
import type { UptoRoutesConfig } from "@x402cloud/middleware";
import {
  createUptoPayload,
  DEFAULT_USDC_ADDRESSES,
  PERMIT2_ADDRESS,
  erc20Abi,
  type FacilitatorSigner,
} from "@x402cloud/evm";
import { encodePaymentHeader, parseUsdcAmount } from "@x402cloud/protocol";
import type { PaymentRequired, MeterFunction } from "@x402cloud/protocol";

const NETWORK = "eip155:84532" as const;
const USDC = DEFAULT_USDC_ADDRESSES[NETWORK];
const PAY_TO = "0x207C6D8f63Bf01F70dc6D372693E8D5943848E88";
const RPC_URL = process.env.RPC_URL ?? "https://sepolia.base.org";
const ANVIL_PORT = 8546;
const ANVIL_RPC = `http://127.0.0.1:${ANVIL_PORT}`;

// Anvil pre-funded accounts (10000 ETH each)
const ANVIL_KEY_0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const ANVIL_KEY_1 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;

// Fixed metered cost: $0.001 (1000 USDC units)
const FIXED_COST = "1000";
const fixedMeter: MeterFunction = () => FIXED_COST;

// ERC-20 transfer ABI
const transferAbi = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  ...erc20Abi,
] as const;

function findAnvil(): string {
  // 1. Already in PATH
  try {
    return execSync("which anvil", { encoding: "utf-8" }).trim();
  } catch {}

  // 2. Default Foundry install location
  const foundryBin = join(homedir(), ".foundry", "bin", "anvil");
  if (existsSync(foundryBin)) return foundryBin;

  throw new Error(
    "anvil not found. Install Foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup"
  );
}

function startAnvil(): Promise<ChildProcess> {
  const anvilBin = findAnvil();
  return new Promise((resolve, reject) => {
    const proc = spawn(anvilBin, [
      "--fork-url", RPC_URL,
      "--port", String(ANVIL_PORT),
      "--silent",
    ], { stdio: "pipe" });

    const timeout = setTimeout(() => reject(new Error("Anvil startup timeout")), 15000);

    proc.stdout?.on("data", (data: Buffer) => {
      if (data.toString().includes("Listening on")) {
        clearTimeout(timeout);
        resolve(proc);
      }
    });

    proc.stderr?.on("data", (data: Buffer) => {
      const msg = data.toString();
      // Anvil logs to stderr too
      if (msg.includes("Listening on")) {
        clearTimeout(timeout);
        resolve(proc);
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    // Fallback: just wait a bit
    setTimeout(() => {
      clearTimeout(timeout);
      resolve(proc);
    }, 3000);
  });
}

describe("x402 payment flow (Anvil fork of Base Sepolia)", () => {
  let anvil: ChildProcess;
  let app: Hono;
  let customerAccount: ReturnType<typeof privateKeyToAccount>;
  let facilitatorAccount: ReturnType<typeof privateKeyToAccount>;

  beforeAll(async () => {
    // Start Anvil forking Base Sepolia
    anvil = await startAnvil();

    customerAccount = privateKeyToAccount(ANVIL_KEY_0);
    facilitatorAccount = privateKeyToAccount(ANVIL_KEY_1);

    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(ANVIL_RPC),
    });

    const customerWallet = createWalletClient({
      chain: baseSepolia,
      transport: http(ANVIL_RPC),
      account: customerAccount,
    });

    // Fund customer with USDC via anvil_setStorageAt (set balance directly in storage)
    const usdcAmount = parseUnits("100", 6); // 100 USDC
    const { keccak256, encodePacked, toHex, pad } = await import("viem");
    const balanceSlot = keccak256(
      encodePacked(
        ["bytes32", "bytes32"],
        [pad(customerAccount.address, { size: 32 }), pad(toHex(9), { size: 32 })]
      )
    );

    // Set USDC balance directly in storage
    await fetch(ANVIL_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "anvil_setStorageAt",
        params: [USDC, balanceSlot, pad(toHex(usdcAmount), { size: 32 })],
        id: 1,
      }),
    });

    // Verify USDC balance
    const balance = await publicClient.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [customerAccount.address],
    }) as bigint;

    // If storage slot trick didn't work, try slot 0-15
    if (balance === 0n) {
      for (let slot = 0; slot <= 15; slot++) {
        const s = keccak256(
          encodePacked(
            ["bytes32", "bytes32"],
            [pad(customerAccount.address, { size: 32 }), pad(toHex(slot), { size: 32 })]
          )
        );
        await fetch(ANVIL_RPC, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "anvil_setStorageAt",
            params: [USDC, s, pad(toHex(usdcAmount), { size: 32 })],
            id: 1,
          }),
        });
        const b = await publicClient.readContract({
          address: USDC,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [customerAccount.address],
        }) as bigint;
        if (b > 0n) {
          console.log(`USDC balance slot found: ${slot}`);
          break;
        }
      }
    }

    // Approve Permit2 for USDC
    await customerWallet.writeContract({
      address: USDC,
      abi: transferAbi,
      functionName: "approve",
      args: [PERMIT2_ADDRESS, maxUint256],
    });

    // Build FacilitatorSigner directly from viem clients
    const { verifyTypedData: viemVerifyTypedData } = await import("viem");
    const facilitatorWallet = createWalletClient({
      chain: baseSepolia,
      transport: http(ANVIL_RPC),
      account: facilitatorAccount,
    });

    const signer: FacilitatorSigner = {
      readContract: async (params) => publicClient.readContract({
        address: params.address,
        abi: params.abi as any,
        functionName: params.functionName,
        args: params.args as any,
      }),
      verifyTypedData: async (params) => viemVerifyTypedData({
        address: params.address,
        domain: params.domain as any,
        types: params.types as any,
        primaryType: params.primaryType,
        message: params.message as any,
        signature: params.signature,
      }),
      writeContract: async (params) => facilitatorWallet.writeContract({
        address: params.address,
        abi: params.abi as any,
        functionName: params.functionName,
        args: params.args as any,
        chain: baseSepolia,
        account: facilitatorAccount,
      }),
      waitForTransactionReceipt: async (params) => {
        const r = await publicClient.waitForTransactionReceipt({ hash: params.hash });
        return { status: r.status === "success" ? "success" as const : "reverted" as const, transactionHash: r.transactionHash };
      },
    };

    // Route config — one paid route, trivial handler
    const routes: UptoRoutesConfig = {
      "POST /paid": {
        network: NETWORK,
        maxPrice: "$0.01",
        payTo: PAY_TO,
        maxTimeoutSeconds: 300,
        description: "e2e test endpoint",
        meter: fixedMeter,
      },
    };

    // Compose: real middleware + real facilitator + trivial handler
    app = new Hono();
    app.use("/*", uptoPaymentMiddleware(routes, signer));
    app.post("/paid", (c) => c.json({ message: "hello" }));
    app.get("/free", (c) => c.json({ message: "free" }));
  });

  afterAll(() => {
    anvil?.kill();
  });

  it("free routes pass through without payment", async () => {
    const res = await app.request("/free");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe("free");
  });

  it("returns 402 without payment header", async () => {
    const res = await app.request("/paid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: "test" }),
    });

    expect(res.status).toBe(402);

    const body = (await res.json()) as PaymentRequired;
    expect(body.x402Version).toBe(2);
    expect(body.accepts).toHaveLength(1);
    expect(body.accepts[0].scheme).toBe("upto");
    expect(body.accepts[0].network).toBe(NETWORK);
    expect(body.accepts[0].maxAmount).toBe(parseUsdcAmount("$0.01"));

    const headerVal = res.headers.get("PAYMENT-REQUIRED");
    expect(headerVal).toBeTruthy();
  });

  it("returns 400 with malformed payment header", async () => {
    const res = await app.request("/paid", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PAYMENT-SIGNATURE": "not-valid-base64!!!",
      },
      body: JSON.stringify({ data: "test" }),
    });

    expect(res.status).toBe(400);
  });

  it("accepts valid payment, returns 200, and settles on-chain", async () => {
    const requirements = {
      scheme: "upto" as const,
      network: NETWORK,
      asset: USDC,
      maxAmount: parseUsdcAmount("$0.01"),
      payTo: PAY_TO,
      maxTimeoutSeconds: 300,
    };

    // Sign payment authorization
    const uptoPayload = await createUptoPayload(
      {
        address: customerAccount.address,
        signTypedData: (params) => customerAccount.signTypedData(params as any),
      },
      requirements,
    );

    const paymentPayload = {
      x402Version: 2,
      resource: { url: "http://localhost/paid" },
      accepted: requirements,
      payload: uptoPayload,
    };

    const encoded = encodePaymentHeader(paymentPayload);

    // Request with payment
    const res = await app.request("/paid", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PAYMENT-SIGNATURE": encoded,
      },
      body: JSON.stringify({ data: "test" }),
    });

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.message).toBe("hello");

    // Settlement headers
    expect(res.headers.get("X-Payment-Settled")).toBe(FIXED_COST);
    expect(res.headers.get("X-Payment-Payer")).toBe(customerAccount.address);

    // Wait for fire-and-forget settlement
    await new Promise((r) => setTimeout(r, 3000));
  });
});
