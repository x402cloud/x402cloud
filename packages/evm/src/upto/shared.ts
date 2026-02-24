import type { VerifySigner } from "../types.js";
import { permit2Domain, permit2WitnessTypes, X402_UPTO_PROXY } from "../constants.js";
import type { Permit2Authorization } from "../types.js";

/**
 * Verify the EIP-712 Permit2 signature.
 * Shared by both upto and exact verify/settle.
 * @param spender — proxy contract address (defaults to X402_UPTO_PROXY for backward compat)
 */
export async function verifyPermit2Signature(
  signer: Pick<VerifySigner, "verifyTypedData">,
  authorization: Permit2Authorization,
  signature: `0x${string}`,
  chainId: number,
  spender: `0x${string}` = X402_UPTO_PROXY,
): Promise<boolean> {
  const { from, permitted, nonce, deadline, witness } = authorization;
  return signer.verifyTypedData({
    address: from,
    domain: permit2Domain(chainId),
    types: permit2WitnessTypes,
    primaryType: "PermitWitnessTransferFrom",
    message: {
      permitted: {
        token: permitted.token,
        amount: BigInt(permitted.amount),
      },
      spender,
      nonce: BigInt(nonce),
      deadline: BigInt(deadline),
      witness: {
        to: witness.to,
        validAfter: BigInt(witness.validAfter),
        extra: witness.extra,
      },
    },
    signature,
  });
}
