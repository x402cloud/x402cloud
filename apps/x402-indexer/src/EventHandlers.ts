import { USDC } from "generated";

// ── x402 Protocol Constants ─────────────────────────────────────────
// The proxy contracts ARE the on-chain x402 identifier.
// Any transaction targeting these addresses is an x402 settlement.
const EXACT_PROXY = "0x4020615294c913f045dc10f0a5cdebf86c280001";
const UPTO_PROXY = "0x4020633461b2895a48930ff97ee8fcde8e520002";

// Known facilitator addresses → name mapping.
// Facilitators that call USDC directly (not via proxy) are identified this way.
const FACILITATOR_NAMES: Record<string, string> = {};

function register(name: string, addresses: string[]) {
  for (const addr of addresses) {
    FACILITATOR_NAMES[addr.toLowerCase()] = name;
  }
}

register("CDP / Coinbase", [
  "0xdbdf3d8ed80f84c35d01c6c9f9271761bad90ba6",
  "0x9aae2b0d1b9dc55ac9bab9556f9a26cb64995fb9",
  "0x3a70788150c7645a21b95b7062ab1784d3cc2104",
  "0x708e57b6650a9a741ab39cae1969ea1d2d10eca1",
  "0xce82eeec8e98e443ec34fda3c3e999cbe4cb6ac2",
  "0x7f6d822467df2a85f792d4508c5722ade96be056",
  "0x001ddabba5782ee48842318bd9ff4008647c8d9c",
  "0x9c09faa49c4235a09677159ff14f17498ac48738",
  "0xcbb10c30a9a72fae9232f41cbbd566a097b4e03a",
  "0x9fb2714af0a84816f5c6322884f2907e33946b88",
  "0x47d8b3c9717e976f31025089384f23900750a5f4",
  "0x94701e1df9ae06642bf6027589b8e05dc7004813",
  "0x552300992857834c0ad41c8e1a6934a5e4a2e4ca",
  "0xd7469bf02d221968ab9f0c8b9351f55f8668ac4f",
  "0x88800e08e20b45c9b1f0480cf759b5bf2f05180c",
  "0x6831508455a716f987782a1ab41e204856055cc2",
  "0xdc8fbad54bf5151405de488f45acd555517e0958",
  "0x91d313853ad458addda56b35a7686e2f38ff3952",
  "0xadd5585c776b9b0ea77e9309c1299a40442d820f",
  "0x4ffeffa616a1460570d1eb0390e264d45a199e91",
  "0x8f5cb67b49555e614892b7233cfddebfb746e531",
  "0x67b9ce703d9ce658d7c4ac3c289cea112fe662af",
  "0x68a96f41ff1e9f2e7b591a931a4ad224e7c07863",
  "0x97acce27d5069544480bde0f04d9f47d7422a016",
  "0xa32ccda98ba7529705a059bd2d213da8de10d101",
]);
register("PayAI", [
  "0xc6699d2aada6c36dfea5c248dd70f9cb0235cb63",
  "0xb2bd29925cbbcea7628279c91945ca5b98bf371b",
  "0x25659315106580ce2a787ceec5efb2d347b539c9",
  "0xb8f41cb13b1f213da1e94e1b742ec1323235c48f",
  "0xe575fa51af90957d66fab6d63355f1ed021b887b",
]);
register("RelAI", ["0x1892f72fdb3a966b2ad8595aa5f7741ef72d6085"]);
register("OpenFacilitator", ["0x7c766f5fd9ab3dc09acad5ecfacc99c4781efe29"]);
register("OpenX402", [
  "0x97316fa4730bc7d3b295234f8e4d04a0a4c093e8",
  "0x97db9b5291a218fc77198c285cefdc943ef74917",
]);
register("402104", ["0x73b2b8df52fbe7c40fe78db52e3dffdd5db5ad07"]);
register("AnySpend", ["0x179761d9eed0f0d1599330cc94b0926e68ae87f1"]);
register("AurraCloud", [
  "0x222c4367a2950f3b53af260e111fc3060b0983ff",
  "0xb70c4fe126de09bd292fe3d1e40c6d264ca6a52a",
  "0xd348e724e0ef36291a28dfeccf692399b0e179f8",
]);
register("CodeNut", [
  "0x8d8fa42584a727488eeb0e29405ad794a105bb9b",
  "0x87af99356d774312b73018b3b6562e1ae0e018c9",
  "0x65058cf664d0d07f68b663b0d4b4f12a5e331a38",
  "0x88e13d4c764a6c840ce722a0a3765f55a85b327e",
]);
register("Corbits", ["0x06f0bfd2c8f36674df5cde852c1eed8025c268c9"]);
register("Dexter", ["0x40272e2eac848ea70db07fd657d799bd309329c4"]);
register("Heurist", [
  "0xb578b7db22581507d62bdbeb85e06acd1be09e11",
  "0x021cc47adeca6673def958e324ca38023b80a5be",
  "0x3f61093f61817b29d9556d3b092e67746af8cdfd",
  "0x290d8b8edcafb25042725cb9e78bcac36b8865f8",
  "0x612d72dc8402bba997c61aa82ce718ea23b2df5d",
]);
register("Meridian", [
  "0x8e7769d440b3460b92159dd9c6d17302b036e2d6",
  "0x3210d7b21bfe1083c9dddbe17e8f947c9029a584",
]);
register("Mogami", ["0xfe0920a0a7f0f8a1ec689146c30c3bbef439bf8a"]);
register("x402cloud", ["0x207c6d8f63bf01f70dc6d372693e8d5943848e88"]);

const KNOWN_FACILITATORS = new Set(Object.keys(FACILITATOR_NAMES));

// ── Settlement Detection ────────────────────────────────────────────

function isX402Settlement(txTo: string, txFrom: string): boolean {
  const to = txTo.toLowerCase();
  const from = txFrom.toLowerCase();

  // Permit2-based: transaction targets a proxy contract
  if (to === EXACT_PROXY || to === UPTO_PROXY) return true;

  // Direct: known facilitator calls USDC transfer
  if (KNOWN_FACILITATORS.has(from)) return true;

  return false;
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

  // Filter: only x402 settlements
  if (!isX402Settlement(txTo, txFrom)) return;

  const scheme = resolveScheme(txTo);
  const facilitator = txFrom;
  const facilitatorName = FACILITATOR_NAMES[facilitator] ?? "unknown";

  // For proxy settlements: payer = event.params.from, payee = event.params.to
  // For direct transfers: facilitator = event.params.from (is the sender)
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
    facilitatorName,
    payer,
    payee,
    amount,
    amountUsd,
    token: event.srcAddress,
  });
});
