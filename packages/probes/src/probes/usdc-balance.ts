import { wrapProbe } from "../wrap.js";
import { resolveFacilitatorAddress } from "./address.js";
import { USDC_ADDRESSES } from "./usdc.js";

const BALANCE_OF_SELECTOR = "0x70a08231";
const USDC_DECIMALS = 6;

/**
 * Reports the USDC balance of the operator/revenue address — the wallet
 * that accumulates settled payments (today the same wallet as the
 * facilitator's gas address; see `Target.operatorAddress`). Purely
 * informational: unlike `gasEstimate`, there is no "too low" threshold for
 * a revenue balance, so this probe never warns or fails on balance alone —
 * only on an RPC error.
 */
export const usdcBalance = wrapProbe("usdc-balance", async (target, signal) => {
  const usdcAddress = USDC_ADDRESSES[target.network];
  if (!usdcAddress) {
    return {
      name: "usdc-balance",
      status: "skip",
      error: `No USDC address for network ${target.network}`,
    };
  }

  let address = target.operatorAddress;
  if (!address) {
    const resolved = await resolveFacilitatorAddress(target, signal);
    if (!resolved.ok) {
      return { name: "usdc-balance", status: "skip", error: resolved.error };
    }
    address = resolved.address;
  }

  const data = `${BALANCE_OF_SELECTOR}${address.slice(2).toLowerCase().padStart(64, "0")}`;

  const response = await fetch(target.rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_call",
      params: [{ to: usdcAddress, data }, "latest"],
      id: 1,
    }),
    signal,
  });

  const json = (await response.json()) as { result?: string; error?: { message: string } };

  if (json.error) {
    return {
      name: "usdc-balance",
      status: "fail",
      error: json.error.message,
      meta: { address, network: target.network },
    };
  }

  const balanceRaw = BigInt(json.result ?? "0x0");
  const balanceUsdc = formatUnits(balanceRaw, USDC_DECIMALS);

  return {
    name: "usdc-balance",
    status: "pass",
    meta: {
      address,
      network: target.network,
      balanceRaw: balanceRaw.toString(),
      balanceUsdc,
    },
  };
});

function formatUnits(value: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const remainder = value % base;
  const decimal = remainder.toString().padStart(decimals, "0");
  return `${whole}.${decimal}`;
}
