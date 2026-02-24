import {
  createPublicClient,
  createWalletClient,
  http,
  verifyTypedData as viemVerifyTypedData,
  type PublicClient,
  type WalletClient,
  type Transport,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  verifyUpto,
  settleUpto,
  type FacilitatorSigner,
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
        abi: params.abi as any,
        functionName: params.functionName,
        args: params.args as any,
      });
    },
    verifyTypedData: async (params) => {
      // Pure ecrecover — no on-chain calls, works on forks and any environment
      return viemVerifyTypedData({
        address: params.address,
        domain: params.domain as any,
        types: params.types as any,
        primaryType: params.primaryType,
        message: params.message as any,
        signature: params.signature,
      });
    },
    writeContract: async (params) => {
      return walletClient.writeContract({
        address: params.address,
        abi: params.abi as any,
        functionName: params.functionName,
        args: params.args as any,
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

  return {
    address: account.address,
    network: config.network,

    async verify(payload, requirements) {
      return verifyUpto(signer, payload, requirements);
    },

    async settle(payload, requirements, settlementAmount) {
      return settleUpto(signer, payload, requirements, settlementAmount);
    },
  };
}
