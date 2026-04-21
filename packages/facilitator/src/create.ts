import {
  createPublicClient,
  createWalletClient,
  http,
  verifyTypedData as viemVerifyTypedData,
  type Abi,
  type PublicClient,
  type WalletClient,
  type Transport,
  type Chain,
  type TypedDataDomain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  verifyUpto,
  settleUpto,
  verifyExact as verifyExactEvm,
  settleExact as settleExactEvm,
  type FacilitatorSigner,
  type UptoPayload,
  type ExactPayload,
} from "@x402cloud/evm";
import type { FacilitatorConfig, Facilitator } from "./types.js";

/** Build a FacilitatorSigner from viem clients */
function buildSigner(
  publicClient: PublicClient<Transport, Chain>,
  walletClient: WalletClient<Transport, Chain>,
): FacilitatorSigner {
  return {
    readContract: async (params) => {
      return publicClient.readContract({
        address: params.address,
        abi: params.abi as Abi,
        functionName: params.functionName,
        args: params.args as readonly unknown[],
      });
    },
    verifyTypedData: async (params) => {
      // Pure ecrecover — no on-chain calls, works on forks and any environment
      return viemVerifyTypedData({
        address: params.address,
        domain: params.domain as TypedDataDomain,
        types: params.types,
        primaryType: params.primaryType,
        message: params.message,
        signature: params.signature,
      });
    },
    writeContract: async (params) => {
      return walletClient.writeContract({
        address: params.address,
        abi: params.abi as Abi,
        functionName: params.functionName,
        args: params.args as readonly unknown[],
        chain: walletClient.chain,
        account: walletClient.account!,
      });
    },
    waitForTransactionReceipt: async (params) => {
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: params.hash,
      });
      return {
        status: receipt.status === "success" ? "success" : "reverted",
        transactionHash: receipt.transactionHash,
      };
    },
  };
}

/**
 * Create a facilitator instance that can verify and settle x402 payments.
 * Supports both upto (metered) and exact (fixed-price) schemes.
 * The facilitator holds a private key to submit settlement transactions on-chain.
 */
export function createFacilitator(config: FacilitatorConfig): Facilitator {
  const chain = config.chain;

  const account = privateKeyToAccount(config.privateKey);

  const publicClient = createPublicClient({
    chain,
    transport: http(config.rpcUrl),
  });

  const walletClient = createWalletClient({
    chain,
    transport: http(config.rpcUrl),
    account,
  });

  const signer = buildSigner(
    publicClient as PublicClient<Transport, Chain>,
    walletClient as WalletClient<Transport, Chain>,
  );

  const schemes: Record<string, import("./types.js").SchemeHandler> = {
    upto: {
      verify: (payload, requirements) =>
        verifyUpto(signer, payload as unknown as UptoPayload, requirements),
      settle: (payload, requirements, ...args) =>
        settleUpto(signer, payload as unknown as UptoPayload, requirements, args[0] as string),
    },
    exact: {
      verify: (payload, requirements) =>
        verifyExactEvm(signer, payload as unknown as ExactPayload, requirements),
      settle: (payload, requirements) =>
        settleExactEvm(signer, payload as unknown as ExactPayload, requirements),
    },
  };

  return {
    address: account.address,
    network: config.network,
    schemes,

    // Backwards-compatible convenience methods — delegate to the schemes map
    async verify(payload, requirements) {
      return verifyUpto(signer, payload, requirements);
    },

    async settle(payload, requirements, settlementAmount) {
      return settleUpto(signer, payload, requirements, settlementAmount);
    },

    async verifyExact(payload, requirements) {
      return verifyExactEvm(signer, payload, requirements);
    },

    async settleExact(payload, requirements) {
      return settleExactEvm(signer, payload, requirements);
    },
  };
}
