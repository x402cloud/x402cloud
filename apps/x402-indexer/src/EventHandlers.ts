import { USDC } from "generated";

// ── x402 Protocol Constants ─────────────────────────────────────────
// The proxy contracts ARE the on-chain x402 identifier.
// Any transaction targeting these addresses is an x402 settlement.
const EXACT_PROXY = "0x4020615294c913f045dc10f0a5cdebf86c280001";
const UPTO_PROXY = "0x4020633461b2895a48930ff97ee8fcde8e520002";

// ── Settlement Detection ────────────────────────────────────────────

function isX402Settlement(txTo: string): boolean {
  const to = txTo.toLowerCase();
  return to === EXACT_PROXY || to === UPTO_PROXY;
}

function resolveScheme(txTo: string): string {
  const to = txTo.toLowerCase();
  if (to === UPTO_PROXY) return "upto";
  return "exact";
}

function networkName(chainId: number): string {
  if (chainId === 8453) return "base";
  if (chainId === 84532) return "base-sepolia";
  return `eip155:${chainId}`;
}

// ── Event Handler ───────────────────────────────────────────────────

USDC.Transfer.handler(async ({ event, context }) => {
  const txTo = (event.transaction?.to ?? "").toLowerCase();
  const txFrom = (event.transaction?.from ?? "").toLowerCase();

  // Filter: only x402 settlements (transactions targeting proxy contracts)
  if (!isX402Settlement(txTo)) return;

  const scheme = resolveScheme(txTo);
  const facilitator = txFrom;

  const payer = event.params.from.toLowerCase();
  const payee = event.params.to.toLowerCase();
  const amount = event.params.value;
  const amountUsd = Number(amount) / 1e6;

  const network = networkName(event.chainId);
  const id = `${event.transaction.hash}-${event.logIndex}`;

  context.Settlement.set({
    id,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    network,
    scheme,
    facilitator,
    payer,
    payee,
    amount,
    amountUsd,
    token: event.srcAddress,
  });
});
