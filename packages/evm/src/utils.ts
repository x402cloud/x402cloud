import type { Network } from "@x402cloud/protocol";

/** Parse CAIP-2 network string to chain ID number */
export function parseChainId(network: Network): number {
  const parts = network.split(":");
  if (parts.length !== 2 || parts[0] !== "eip155") {
    throw new Error(`${network} is not an EVM network. Use @x402cloud/evm only for eip155:* networks.`);
  }
  const chainId = parseInt(parts[1], 10);
  if (isNaN(chainId)) {
    throw new Error(`Invalid chain ID in network: ${network}`);
  }
  return chainId;
}
