import { wrapProbe } from "../wrap.js";

const MIN_BALANCE_WEI = 1_000_000_000_000_000n; // 0.001 ETH

export const gasEstimate = wrapProbe("gas-estimate", async (target, signal) => {
  if (target.facilitator === null) {
    return { name: "gas-estimate", status: "skip" };
  }

  // Get facilitator address from /supported endpoint (or use target override)
  let address = target.facilitatorAddress;

  if (!address) {
    const supportedResponse = await fetch(`${target.facilitator}/supported`, { signal });

    if (!supportedResponse.ok) {
      return {
        name: "gas-estimate",
        status: "fail",
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
    return {
      name: "gas-estimate",
      status: "fail",
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
