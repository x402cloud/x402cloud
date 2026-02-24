import type { Probe } from "../types.js";

const MIN_BALANCE_WEI = 1_000_000_000_000_000n; // 0.001 ETH

export const gasEstimate: Probe = async (target) => {
  const start = Date.now();

  if (target.facilitator === null) {
    return { name: "gas-estimate", status: "skip", latencyMs: 0 };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    // Get facilitator address from /supported endpoint (or use target override)
    let address = target.facilitatorAddress;

    if (!address) {
      const supportedResponse = await fetch(`${target.facilitator}/supported`, {
        signal: controller.signal,
      });

      if (!supportedResponse.ok) {
        clearTimeout(timeout);
        return {
          name: "gas-estimate",
          status: "fail",
          latencyMs: Date.now() - start,
          error: `Could not fetch facilitator address: ${supportedResponse.status}`,
        };
      }

      const supported = (await supportedResponse.json()) as {
        address?: string;
        facilitator?: string;
      };
      address = supported.facilitator ?? supported.address;
    }

    if (!address) {
      clearTimeout(timeout);
      return {
        name: "gas-estimate",
        status: "fail",
        latencyMs: Date.now() - start,
        error: "Facilitator did not return an address",
      };
    }

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
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const json = (await balanceResponse.json()) as { result?: string; error?: { message: string } };

    if (json.error) {
      return {
        name: "gas-estimate",
        status: "fail",
        latencyMs: Date.now() - start,
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
        latencyMs: Date.now() - start,
        error: "Facilitator has zero ETH balance",
        meta: { address, balanceWei: balanceWei.toString(), balanceEth },
      };
    }

    if (balanceWei < MIN_BALANCE_WEI) {
      return {
        name: "gas-estimate",
        status: "warn",
        latencyMs: Date.now() - start,
        error: `Facilitator ETH balance is low: ${balanceEth} ETH`,
        meta: { address, balanceWei: balanceWei.toString(), balanceEth },
      };
    }

    return {
      name: "gas-estimate",
      status: "pass",
      latencyMs: Date.now() - start,
      meta: { address, balanceWei: balanceWei.toString(), balanceEth },
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return {
      name: "gas-estimate",
      status: "fail",
      latencyMs: Date.now() - start,
      error: message,
    };
  }
};

function formatEth(wei: bigint): string {
  const whole = wei / 1_000_000_000_000_000_000n;
  const remainder = wei % 1_000_000_000_000_000_000n;
  const decimal = remainder.toString().padStart(18, "0").slice(0, 6);
  return `${whole}.${decimal}`;
}
