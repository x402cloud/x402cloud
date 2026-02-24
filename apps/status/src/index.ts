import { Hono } from "hono";
import { allProbes, runProbes, TARGETS, type Target } from "@x402cloud/probes";
import { renderDashboard } from "./html.js";

type Env = {
  TESTNET_RPC_URL?: string;
  PRODUCTION_RPC_URL?: string;
};

function resolveTarget(name: string, env: Env): Target | undefined {
  const base = TARGETS[name];
  if (!base) return undefined;

  // Override RPCs from env vars (private RPCs to avoid rate limits)
  if (name === "testnet" && env.TESTNET_RPC_URL) {
    return { ...base, rpc: env.TESTNET_RPC_URL };
  }
  if (name === "production" && env.PRODUCTION_RPC_URL) {
    return { ...base, rpc: env.PRODUCTION_RPC_URL };
  }
  return base;
}

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/status", async (c) => {
  const targetName = c.req.query("target") ?? "testnet";
  const target = resolveTarget(targetName, c.env);
  if (!target) return c.json({ error: `Unknown target: ${targetName}` }, 400);

  const host = c.req.header("host") ?? "";
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  if (targetName === "local" && !isLocal) {
    return c.json({ error: "local target only available from localhost" }, 400);
  }

  const report = await runProbes(allProbes, target);
  return c.json(report);
});

app.get("/", async (c) => {
  const targetName = c.req.query("target") ?? "testnet";
  const target = resolveTarget(targetName, c.env);
  if (!target) return c.text(`Unknown target: ${targetName}`, 400);

  const host = c.req.header("host") ?? "";
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const visibleTargets = isLocal
    ? Object.keys(TARGETS)
    : Object.keys(TARGETS).filter((t) => t !== "local");

  const report = await runProbes(allProbes, target);
  const html = renderDashboard(report, visibleTargets);
  return c.html(html);
});

export default app;
