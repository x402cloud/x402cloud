/**
 * End-to-end smoke test against the live x402cloud services.
 *
 * Usage:
 *   TEST_PRIVATE_KEY=0x... pnpm dlx tsx scripts/sepolia-smoke.ts
 *   TEST_PRIVATE_KEY=0x... pnpm dlx tsx scripts/sepolia-smoke.ts --network=base-mainnet
 *
 * Requires:
 *   - Base Sepolia testnet USDC on the signer wallet (faucet:
 *     https://faucet.circle.com — pick Base Sepolia). A few cents is enough.
 *   - A small dust of Base Sepolia ETH on the signer for the one-off Permit2
 *     `approve()` if it has never approved USDC → Permit2 before.
 *   - For --network=base-mainnet: real USDC bridged onto Base, plus dust ETH.
 *
 * If anything goes wrong on the facilitator side (settlement revert, RPC
 * outage), the signer wallet does NOT lose funds — Permit2 signatures are
 * single-use and bounded by `maxAmount`. The facilitator pays gas, the signer
 * only loses the metered USDC for successful calls.
 */

import { createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { createAgentClient, type AgentClient } from "@x402cloud/agent";

type NetworkKey = "base-sepolia" | "base-mainnet";

const NETWORK_CONFIG: Record<
  NetworkKey,
  { catalogUrl: string; chain: typeof base | typeof baseSepolia }
> = {
  "base-sepolia": {
    catalogUrl: "https://marketplace.x402cloud.ai",
    chain: baseSepolia,
  },
  "base-mainnet": {
    catalogUrl: "https://marketplace-mainnet.x402cloud.ai",
    chain: base,
  },
};

type CheckResult =
  | { name: string; status: "pass"; ms: number; detail?: string }
  | { name: string; status: "fail"; ms: number; error: string }
  | { name: string; status: "skip"; ms: number; reason: string };

function parseArgs(argv: readonly string[]): { network: NetworkKey } {
  const netArg = argv.find((a) => a.startsWith("--network="));
  const value = netArg?.split("=")[1] ?? "base-sepolia";
  if (value !== "base-sepolia" && value !== "base-mainnet") {
    throw new Error(`Unknown --network=${value}. Use base-sepolia or base-mainnet.`);
  }
  return { network: value };
}

function readPrivateKey(): Hex {
  const key = process.env.TEST_PRIVATE_KEY;
  if (!key || !key.startsWith("0x") || key.length !== 66) {
    throw new Error("TEST_PRIVATE_KEY must be set to a 0x-prefixed 32-byte hex string.");
  }
  return key as Hex;
}

async function runCheck(
  name: string,
  fn: () => Promise<{ detail?: string; skipReason?: string }>,
): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    const out = await fn();
    const ms = Date.now() - t0;
    if (out.skipReason) return { name, status: "skip", ms, reason: out.skipReason };
    return { name, status: "pass", ms, detail: out.detail };
  } catch (err) {
    const ms = Date.now() - t0;
    const error = err instanceof Error ? err.message : String(err);
    return { name, status: "fail", ms, error };
  }
}

async function callAndPrintTx<T>(
  client: AgentClient,
  id: string,
  body: unknown,
): Promise<{ data: T; settledTx: string | null }> {
  const svc = await client.getService(id);
  const payingFetch = await client.fetchFor(id);
  const res = await payingFetch(svc.endpoint.url, {
    method: svc.endpoint.method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
  }
  const settledTx = res.headers.get("X-Payment-Tx") ?? res.headers.get("X-Payment-Settled");
  const data = (await res.json()) as T;
  return { data, settledTx };
}

function isNotDeployedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /ENOTFOUND|getaddrinfo|HTTP 404|404 Not Found|fetch failed/.test(msg);
}

async function main(): Promise<number> {
  const { network } = parseArgs(process.argv.slice(2));
  const cfg = NETWORK_CONFIG[network];
  const account = privateKeyToAccount(readPrivateKey());
  const walletClient = createWalletClient({ account, chain: cfg.chain, transport: http() });

  const client = createAgentClient({
    catalogUrl: cfg.catalogUrl,
    signer: {
      address: account.address,
      signTypedData: (params) =>
        walletClient.signTypedData({
          account,
          domain: params.domain,
          types: params.types,
          primaryType: params.primaryType,
          message: params.message,
        }),
    },
  });

  console.log(`x402cloud smoke — network=${network} signer=${account.address}`);
  console.log(`catalog=${cfg.catalogUrl}\n`);

  const results: CheckResult[] = [];

  results.push(
    await runCheck("marketplace.list-services", async () => {
      const services = await client.discover();
      if (services.length < 3) throw new Error(`expected >= 3 services, got ${services.length}`);
      return { detail: `${services.length} services` };
    }),
  );

  for (const [name, id, body] of [
    ["infer.chat", "infer-fast", { messages: [{ role: "user", content: "ping" }] }],
    ["sandbox.python", "sandbox-python", { code: "print(1+1)", timeout: 5000 }],
    ["scrape.page", "scrape-page", { url: "https://example.com" }],
  ] as const) {
    results.push(
      await runCheck(name, async () => {
        try {
          const { data, settledTx } = await callAndPrintTx<Record<string, unknown>>(client, id, body);
          validate(name, data);
          return { detail: settledTx ? `tx=${settledTx}` : "no settle header" };
        } catch (err) {
          if (isNotDeployedError(err)) return { skipReason: "not deployed (DNS/404)" };
          throw err;
        }
      }),
    );
  }

  printSummary(results);
  return results.some((r) => r.status === "fail") ? 1 : 0;
}

function validate(name: string, data: Record<string, unknown>): void {
  if (name === "infer.chat") {
    if (!Array.isArray((data as { choices?: unknown }).choices)) {
      throw new Error("response missing `choices` array");
    }
    return;
  }
  if (name === "sandbox.python") {
    const d = data as { stdout?: string; exitCode?: number };
    if (d.stdout !== "2\n" || d.exitCode !== 0) {
      throw new Error(`unexpected sandbox output: ${JSON.stringify(d)}`);
    }
    return;
  }
  if (name === "scrape.page") {
    const md = (data as { markdown?: string }).markdown ?? "";
    if (!md.includes("Example Domain")) throw new Error("markdown missing 'Example Domain'");
    return;
  }
}

function printSummary(results: readonly CheckResult[]): void {
  console.log("\n— results —");
  for (const r of results) {
    const tag = r.status === "pass" ? "PASS" : r.status === "skip" ? "SKIP" : "FAIL";
    const tail =
      r.status === "pass"
        ? r.detail ?? ""
        : r.status === "skip"
          ? r.reason
          : r.error;
    console.log(`${tag.padEnd(4)}  ${r.name.padEnd(28)}  ${String(r.ms).padStart(5)}ms  ${tail}`);
  }
  const pass = results.filter((r) => r.status === "pass").length;
  const fail = results.filter((r) => r.status === "fail").length;
  const skip = results.filter((r) => r.status === "skip").length;
  console.log(`\ntotal: ${pass} pass, ${fail} fail, ${skip} skip`);
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
