import { wrapProbe } from "../wrap.js";
import { resolveFacilitatorAddress } from "./address.js";

// Warn threshold per docs/MAINNET-RUNBOOK.md §7: warn when the facilitator
// gas wallet drops below 0.01 ETH (a few hundred settlements of headroom).
const MIN_BALANCE_WEI = 10_000_000_000_000_000n; // 0.01 ETH

export const gasEstimate = wrapProbe("gas-estimate", async (target, signal) => {
  if (target.facilitator === null) {
    return { name: "gas-estimate", status: "skip" };
  }

  const resolved = await resolveFacilitatorAddress(target, signal);
  if (!resolved.ok) {
    return { name: "gas-estimate", status: "fail", error: resolved.error };
  }
  const address = resolved.address;

  // Check ETH balance via JSON-RPC
  const balanceResponse = await fetch(target.rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_getBalance",
      params: [address, "latest"],
      id: 1,
    }),
    signal,
  });

  const json = (await balanceResponse.json()) as { result?: string; error?: { message: string } };

  if (json.error) {
    return {
      name: "gas-estimate",
      status: "fail",
      error: json.error.message,
      meta: { address },
    };
  }

  const balanceWei = BigInt(json.result ?? "0x0");
  const balanceEth = formatEth(balanceWei);

  if (balanceWei === 0n) {
    return {
      name: "gas-estimate",
      status: "fail",
      error: "Facilitator has zero ETH balance",
      meta: { address, balanceWei: balanceWei.toString(), balanceEth },
    };
  }

  if (balanceWei < MIN_BALANCE_WEI) {
    return {
      name: "gas-estimate",
      status: "warn",
      error: `Facilitator ETH balance is low: ${balanceEth} ETH`,
      meta: { address, balanceWei: balanceWei.toString(), balanceEth },
    };
  }

  return {
    name: "gas-estimate",
    status: "pass",
    meta: { address, balanceWei: balanceWei.toString(), balanceEth },
  };
});

function formatEth(wei: bigint): string {
  const whole = wei / 1_000_000_000_000_000_000n;
  const remainder = wei % 1_000_000_000_000_000_000n;
  const decimal = remainder.toString().padStart(18, "0").slice(0, 6);
  return `${whole}.${decimal}`;
}
