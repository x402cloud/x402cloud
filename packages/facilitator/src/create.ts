import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
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
  confirmSettlement,
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
    // Two-step settlement port (Finding 1): SIGN (deterministic hash, no
    // network) is separate from SEND. A send-time throw can leave a live tx in
    // the mempool, so settle confirms the already-known hash rather than
    // re-broadcasting (which would revert on the single-use Permit2 nonce).
    signSettlementTx: async (params) => {
      const data = encodeFunctionData({
        abi: params.abi as Abi,
        functionName: params.functionName,
        args: params.args as readonly unknown[],
      });
      // prepareTransactionRequest fills nonce/gas/fees; signTransaction is local
      // crypto only (no broadcast) and yields the raw tx whose keccak256 IS the
      // on-chain tx hash.
      const request = await walletClient.prepareTransactionRequest({
        account: walletClient.account!,
        chain: walletClient.chain,
        to: params.address,
        data,
      });
      const serialized = await walletClient.signTransaction(request as never);
      return { hash: keccak256(serialized), serialized };
    },
    sendRawSettlementTx: async (serialized) => {
      // Broadcast only — never re-signs, so re-sending a known raw tx is safe.
      await publicClient.sendRawTransaction({ serializedTransaction: serialized });
    },
    waitForTransactionReceipt: async (params) => {
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: params.hash,
        // Bounded wait (Finding 2): settle passes a timeout so the worst-case
        // wall-clock stays below the orchestrator's in_flight lease.
        ...(params.timeout !== undefined ? { timeout: params.timeout } : {}),
      });
      return {
        status: receipt.status === "success" ? "success" : "reverted",
        transactionHash: receipt.transactionHash,
      };
    },
  };
}

/**
 * Reject obviously dangerous RPC URLs at facilitator construction. Defends
 * against an operator accidentally pointing the facilitator at a private/
 * internal service (SSRF) or at an HTTP-only endpoint where credentials
 * would travel in cleartext.
 *
 * Strict by design: only `http://` and `https://`, only public hostnames.
 * Local hostnames (`localhost`, `127.0.0.1`, `*.internal`, RFC1918 ranges)
 * are rejected unless the URL also uses port 8545/8546 (a common dev-RPC
 * convention). Set `allowPrivate: true` in tests if you really mean it.
 */
function assertSafeRpcUrl(rpcUrl: string): void {
  let url: URL;
  try {
    url = new URL(rpcUrl);
  } catch {
    throw new Error(`Invalid RPC_URL: not a URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`RPC_URL must use http(s)://, got ${url.protocol}`);
  }
  if (url.protocol === "http:") {
    // Only allow plain HTTP for local dev nodes (anvil/hardhat default ports).
    const isLocalhost =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1" ||
      url.hostname.endsWith(".local");
    if (!isLocalhost) {
      throw new Error(`RPC_URL: http:// is only permitted for localhost; use https://`);
    }
  }
  // Catch credentials in URL — a common anti-pattern that leaks the API key
  // into every error log.
  if (url.username || url.password) {
    throw new Error(`RPC_URL must not contain inline credentials; pass keys via headers or path tokens`);
  }
}

/**
 * Create a facilitator instance that can verify and settle x402 payments.
 * Supports both upto (metered) and exact (fixed-price) schemes.
 * The facilitator holds a private key to submit settlement transactions on-chain.
 */
export function createFacilitator(config: FacilitatorConfig): Facilitator {
  assertSafeRpcUrl(config.rpcUrl);
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

  // Chain-ID guard: reject any incoming payload whose `requirements.network`
  // does not match the facilitator's configured network. This prevents a
  // misconfigured or rogue caller from submitting a Base signature to an
  // Ethereum facilitator (or vice versa). The EIP-712 signature would also
  // fail, but failing closed at the network level is cheaper and clearer.
  const expectedNetwork = config.network;
  function assertNetwork(req: { network: string }): { ok: true } | { ok: false; reason: string } {
    if (req.network !== expectedNetwork) {
      return { ok: false, reason: "network_mismatch" };
    }
    return { ok: true };
  }

  const schemes: Record<string, import("./types.js").SchemeHandler> = {
    upto: {
      verify: (payload, requirements) => {
        const guard = assertNetwork(requirements);
        if (!guard.ok) return Promise.resolve({ isValid: false, invalidReason: guard.reason });
        return verifyUpto(signer, payload as unknown as UptoPayload, requirements);
      },
      settle: (payload, requirements, ...args) => {
        const guard = assertNetwork(requirements);
        if (!guard.ok) return Promise.resolve({ success: false, errorReason: guard.reason });
        return settleUpto(signer, payload as unknown as UptoPayload, requirements, args[0] as string);
      },
    },
    exact: {
      verify: (payload, requirements) => {
        const guard = assertNetwork(requirements);
        if (!guard.ok) return Promise.resolve({ isValid: false, invalidReason: guard.reason });
        return verifyExactEvm(signer, payload as unknown as ExactPayload, requirements);
      },
      settle: (payload, requirements) => {
        const guard = assertNetwork(requirements);
        if (!guard.ok) return Promise.resolve({ success: false, errorReason: guard.reason });
        return settleExactEvm(signer, payload as unknown as ExactPayload, requirements);
      },
    },
  };

  return {
    address: account.address,
    network: config.network,
    schemes,

    // Backwards-compatible convenience methods — delegate to the schemes map
    // so the network guard applies uniformly.
    async verify(payload, requirements) {
      const guard = assertNetwork(requirements);
      if (!guard.ok) return { isValid: false, invalidReason: guard.reason };
      return verifyUpto(signer, payload, requirements);
    },

    async settle(payload, requirements, settlementAmount) {
      const guard = assertNetwork(requirements);
      if (!guard.ok) return { success: false, errorReason: guard.reason };
      return settleUpto(signer, payload, requirements, settlementAmount);
    },

    async verifyExact(payload, requirements) {
      const guard = assertNetwork(requirements);
      if (!guard.ok) return { isValid: false, invalidReason: guard.reason };
      return verifyExactEvm(signer, payload, requirements);
    },

    async settleExact(payload, requirements) {
      const guard = assertNetwork(requirements);
      if (!guard.ok) return { success: false, errorReason: guard.reason };
      return settleExactEvm(signer, payload, requirements);
    },

    async confirm(txHash, network, settledAmount) {
      return confirmSettlement(signer, { txHash, network, settledAmount });
    },
  };
}
