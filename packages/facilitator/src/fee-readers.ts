import type { PublicClient, Transport, Chain } from "viem";
import type { Scheme } from "@x402cloud/protocol";
import type { FeeDataReader, L1DataFeeReader, EthUsdReader } from "./fee.js";
import { SETTLE_CALLDATA_BYTES } from "./fee.js";

/**
 * Real (viem-backed) implementations of the fee.ts reader ports. Kept
 * separate from fee.ts so the pure computation module never imports viem —
 * `fee.test.ts` mocks these three small interfaces directly and never mocks
 * viem internals, per this repo's testing philosophy. These adapters are thin
 * enough that they're exercised by the Anvil-fork e2e suite rather than
 * unit-mocked (mocking viem's own RPC methods would just re-assert viem's
 * own behaviour).
 */

/**
 * OP-stack `GasPriceOracle` predeploy — identical address on every OP-stack
 * chain (Optimism, Base, …). Read-only; a wrong address here fails the
 * `getL1Fee` call (caught by `computeSettlementFee`'s fail-closed per-reader
 * try/catch), never a fund-moving mistake.
 */
export const OP_STACK_GAS_PRICE_ORACLE = "0x420000000000000000000000000000000000000F" as const;

const gasPriceOracleAbi = [
  {
    type: "function",
    name: "getL1Fee",
    stateMutability: "view",
    inputs: [{ name: "_data", type: "bytes" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const chainlinkAggregatorAbi = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

/** Live base fee (latest block) + suggested priority fee, via the facilitator's own RPC client. */
export function viemFeeDataReader(publicClient: PublicClient<Transport, Chain>): FeeDataReader {
  return {
    async getFeeData() {
      const [block, maxPriorityFeePerGas] = await Promise.all([
        publicClient.getBlock({ blockTag: "latest" }),
        publicClient.estimateMaxPriorityFeePerGas(),
      ]);
      const baseFeePerGas = block.baseFeePerGas;
      if (baseFeePerGas === null || baseFeePerGas === undefined) {
        throw new Error("no baseFeePerGas on latest block (pre-EIP1559 chain?)");
      }
      return { baseFeePerGas, maxPriorityFeePerGas };
    },
  };
}

/** Zero-filled placeholder calldata of the configured length — see fee.ts's measurement status note. */
function placeholderCalldata(byteLength: number): `0x${string}` {
  return `0x${"00".repeat(byteLength)}` as `0x${string}`;
}

/** Base's L1 data-fee component, read from the OP-stack GasPriceOracle predeploy. */
export function viemL1DataFeeReader(publicClient: PublicClient<Transport, Chain>): L1DataFeeReader {
  return {
    async getL1Fee(scheme: Scheme) {
      const data = placeholderCalldata(SETTLE_CALLDATA_BYTES[scheme]);
      const fee = await publicClient.readContract({
        address: OP_STACK_GAS_PRICE_ORACLE,
        abi: gasPriceOracleAbi,
        functionName: "getL1Fee",
        args: [data],
      });
      // Runtime-validate rather than trust the type assertion: an
      // unexpected (e.g. undefined, from a misconfigured RPC or test double)
      // result must THROW here so computeSettlementFee's fail-closed
      // try/catch around this reader actually catches it, rather than
      // propagating a non-bigint into downstream arithmetic uncaught.
      return BigInt(fee);
    },
  };
}

/**
 * Chainlink ETH/USD feed reader. `feedAddress` is REQUIRED and has no
 * built-in default — an unverified contract address masquerading as correct
 * is worse than failing closed, so an operator must supply the address for
 * their network explicitly (see docs/PRODUCTION-READINESS.md). Omitting it
 * is a valid, intentional way to force the fail-closed fallback path.
 */
export function chainlinkEthUsdReader(
  publicClient: PublicClient<Transport, Chain>,
  feedAddress: `0x${string}` | undefined,
): EthUsdReader {
  return {
    async getEthUsd() {
      if (!feedAddress) {
        throw new Error("no ETH/USD feed address configured");
      }
      const [[, answer], decimals] = await Promise.all([
        publicClient.readContract({
          address: feedAddress,
          abi: chainlinkAggregatorAbi,
          functionName: "latestRoundData",
        }),
        publicClient.readContract({
          address: feedAddress,
          abi: chainlinkAggregatorAbi,
          functionName: "decimals",
        }),
      ]);
      if (answer <= 0n) {
        throw new Error("Chainlink feed returned a non-positive answer");
      }
      return { price: answer, decimals };
    },
  };
}
