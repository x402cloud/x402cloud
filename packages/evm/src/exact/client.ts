import type { PaymentRequirements } from "@x402cloud/protocol";
import type { ClientSigner, ExactPayload } from "../types.js";
import { permit2Domain, permit2WitnessTypes, X402_EXACT_PROXY } from "../constants.js";
import { parseChainId } from "../utils.js";

/**
 * Create a signed exact payment payload.
 * Client authorizes the exact amount. Server settles for the full authorized amount.
 */
export async function createExactPayload(
  signer: ClientSigner,
  requirements: PaymentRequirements,
): Promise<ExactPayload> {
  const chainId = parseChainId(requirements.network);
  const now = Math.floor(Date.now() / 1000);
  const deadline = now + requirements.maxTimeoutSeconds;
  const validAfter = now - 60; // 1 minute buffer for clock skew

  // 256-bit random nonce (Permit2 uses unordered nonces)
  const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = BigInt("0x" + Array.from(nonceBytes).map(b => b.toString(16).padStart(2, "0")).join(""));

  const message = {
    permitted: {
      token: requirements.asset as `0x${string}`,
      amount: BigInt(requirements.maxAmount),
    },
    spender: X402_EXACT_PROXY,
    nonce,
    deadline: BigInt(deadline),
    witness: {
      to: requirements.payTo as `0x${string}`,
      validAfter: BigInt(validAfter),
      extra: "0x" as `0x${string}`,
    },
  };

  const signature = await signer.signTypedData({
    domain: permit2Domain(chainId),
    types: permit2WitnessTypes,
    primaryType: "PermitWitnessTransferFrom",
    message,
  });

  return {
    signature,
    permit2Authorization: {
      from: signer.address,
      permitted: {
        token: requirements.asset as `0x${string}`,
        amount: requirements.maxAmount,
      },
      spender: X402_EXACT_PROXY,
      nonce: nonce.toString(),
      deadline: deadline.toString(),
      witness: {
        to: requirements.payTo as `0x${string}`,
        validAfter: validAfter.toString(),
        extra: "0x",
      },
    },
  };
}
