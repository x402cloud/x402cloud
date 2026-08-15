import { Hono } from "hono";
import {
  allProbes,
  runProbes,
  summarizeSettlements,
  TARGETS,
  type KVList,
  type Target,
} from "@x402cloud/probes";
import { renderDashboard } from "./html.js";
import {
  evaluateProbeAlerts,
  evaluateSettlementAlert,
  formatAlertMessage,
  type AlertCondition,
} from "./alerts.js";

type Env = {
  TESTNET_RPC_URL?: string;
  MAINNET_RPC_URL?: string;
  /** Overrides the operator/revenue address used by the usdc-balance probe, for all targets. */
  OPERATOR_ADDRESS?: string;
  /**
   * Read-only settlement records (see apps/infer/src/recorder.ts). Absent
   * until the operator binds the same SETTLEMENTS KV namespace here — see
   * wrangler.toml for the exact command. This code only ever calls
   * `list`/`get` on it, never `put`/`delete`.
   */
  SETTLEMENTS?: KVList;
  /**
   * ntfy.sh-style webhook URL the cron alert check POSTs a plain-text
   * summary to. Set via `wrangler secret put ALERT_WEBHOOK_URL` — never a
   * `[vars]` entry, never committed. Absent => the cron check is a no-op.
   */
  ALERT_WEBHOOK_URL?: string;
};

function resolveTarget(name: string, env: Env): Target | undefined {
  const base = TARGETS[name];
  if (!base) return undefined;

  let target = base;

  // Override RPCs from env vars (private RPCs to avoid rate limits)
  if (name === "testnet" && env.TESTNET_RPC_URL) {
    target = { ...target, rpc: env.TESTNET_RPC_URL };
  }
  if (name === "mainnet" && env.MAINNET_RPC_URL) {
    target = { ...target, rpc: env.MAINNET_RPC_URL };
  }
  if (env.OPERATOR_ADDRESS) {
    target = { ...target, operatorAddress: env.OPERATOR_ADDRESS };
  }

  return target;
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

  const [report, settlements] = await Promise.all([
    runProbes(allProbes, target),
    summarizeSettlements(c.env.SETTLEMENTS),
  ]);
  // Additive field — the existing `target`/`timestamp`/`results`/`summary`
  // shape is unchanged, so any consumer reading those keeps working.
  return c.json({ ...report, settlements });
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

  const [report, settlements] = await Promise.all([
    runProbes(allProbes, target),
    summarizeSettlements(c.env.SETTLEMENTS),
  ]);
  const html = renderDashboard(report, visibleTargets, settlements);
  return c.html(html);
});

/**
 * Cron-triggered, read-only alert check (§4 of workspace#43): re-runs the
 * probe suite for every non-local target plus the settlement summary, and
 * POSTs a plain-text alert to `ALERT_WEBHOOK_URL` if any condition holds.
 * A no-op with no webhook configured. No dedup/suppression yet — a
 * condition that stays true fires again on every tick; see DEPLOY.md.
 */
export async function runAlertCheck(env: Env): Promise<void> {
  if (!env.ALERT_WEBHOOK_URL) return;

  const settlements = await summarizeSettlements(env.SETTLEMENTS);
  const conditions: AlertCondition[] = [];

  const settlementAlert = evaluateSettlementAlert(settlements);
  if (settlementAlert) conditions.push(settlementAlert);

  for (const name of Object.keys(TARGETS).filter((t) => t !== "local")) {
    const target = resolveTarget(name, env);
    if (!target) continue;
    const report = await runProbes(allProbes, target);
    conditions.push(...evaluateProbeAlerts(name, report));
  }

  if (conditions.length === 0) return;

  await fetch(env.ALERT_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain; charset=utf-8", Title: "x402cloud status alert" },
    body: formatAlertMessage(conditions),
  });
}

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runAlertCheck(env));
  },
};

export { app, resolveTarget };
