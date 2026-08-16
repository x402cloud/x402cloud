import type { PaymentRequirements, VerifyResponse } from "@x402cloud/protocol";
import type { VerifySigner, ClientSigner, Permit2Authorization, Permit2Witness } from "./types.js";
import {
  PERMIT2_ADDRESS,
  permit2Domain,
  permit2WitnessTypes,
  erc20Abi,
  type WitnessField,
} from "./constants.js";
import { parseChainId, parseUnixSeconds } from "./utils.js";

/**
 * Convert a witness record (string values, as transported in JSON) into the
 * EIP-712 message shape, driven by the scheme's witness field list:
 * `uint256` fields become bigint, `address` fields pass through.
 */
function witnessMessage(
  witnessFields: readonly WitnessField[],
  witness: Record<string, string>,
): Record<string, string | bigint> {
  return Object.fromEntries(
    witnessFields.map((f) => [f.name, f.type === "uint256" ? BigInt(witness[f.name]) : witness[f.name]]),
  );
}

/**
 * Verify the EIP-712 Permit2 signature.
 * Used by both upto and exact verify/settle.
 * @param spender - proxy contract address (upto or exact)
 * @param witnessFields - the scheme's Witness struct fields
 */
export async function verifyPermit2Signature(
  signer: Pick<VerifySigner, "verifyTypedData">,
  authorization: Permit2Authorization,
  signature: `0x${string}`,
  chainId: number,
  spender: `0x${string}`,
  witnessFields: readonly WitnessField[],
): Promise<boolean> {
  const { from, permitted, nonce, deadline, witness } = authorization;
  return signer.verifyTypedData({
    address: from,
    domain: permit2Domain(chainId),
    types: permit2WitnessTypes(witnessFields),
    primaryType: "PermitWitnessTransferFrom",
    message: {
      permitted: {
        token: permitted.token,
        amount: BigInt(permitted.amount),
      },
      spender,
      nonce: BigInt(nonce),
      deadline: BigInt(deadline),
      witness: witnessMessage(witnessFields, witness as Record<string, string>),
    },
    signature,
  });
}

/**
 * Shared Permit2 authorization verification.
 * Both upto and exact schemes perform identical checks — only the proxy
 * address and witness shape differ.
 * Checks: spender, recipient, deadline, validAfter, amount, signature, allowance, balance.
 */
export async function verifyPermit2Authorization(
  signer: VerifySigner,
  payload: { permit2Authorization: Permit2Authorization; signature: `0x${string}` },
  requirements: PaymentRequirements,
  proxyAddress: `0x${string}`,
  witnessFields: readonly WitnessField[],
): Promise<VerifyResponse> {
  const { permit2Authorization, signature } = payload;
  const { from, permitted, spender, deadline, witness } = permit2Authorization;
  const now = Math.floor(Date.now() / 1000);

  // 1. Spender must be the expected proxy
  if (spender.toLowerCase() !== proxyAddress.toLowerCase()) {
    return { isValid: false, invalidReason: "invalid_spender" };
  }

  // 2. Recipient must match payTo
  if (witness.to.toLowerCase() !== requirements.payTo.toLowerCase()) {
    return { isValid: false, invalidReason: "invalid_recipient" };
  }

  // 3. Deadline not expired (6-second buffer for block time).
  //    Use BigInt parsing — `parseInt("999...")` returns Infinity, which
  //    silently passes any `< now` check and lets a forged deadline replay
  //    forever. `parseUnixSeconds` rejects non-numerics, negatives, and
  //    values past `MAX_UNIX_SECONDS` (~year 2400).
  const deadlineSec = parseUnixSeconds(deadline);
  if (deadlineSec === null) {
    return { isValid: false, invalidReason: "invalid_deadline" };
  }
  if (deadlineSec < BigInt(now + 6)) {
    return { isValid: false, invalidReason: "deadline_expired" };
  }

  // 4. validAfter is in the past
  const validAfterSec = parseUnixSeconds(witness.validAfter);
  if (validAfterSec === null) {
    return { isValid: false, invalidReason: "invalid_valid_after" };
  }
  if (validAfterSec > BigInt(now)) {
    return { isValid: false, invalidReason: "not_yet_valid" };
  }

  // 5. Authorized amount >= the quoted price
  if (BigInt(permitted.amount) < BigInt(requirements.amount)) {
    return { isValid: false, invalidReason: "insufficient_authorized_amount" };
  }

  // 6. Verify EIP-712 signature
  const chainId = parseChainId(requirements.network);
  try {
    const isValidSig = await verifyPermit2Signature(
      signer,
      permit2Authorization,
      signature,
      chainId,
      proxyAddress,
      witnessFields,
    );
    if (!isValidSig) {
      return { isValid: false, invalidReason: "invalid_signature" };
    }
  } catch {
    return { isValid: false, invalidReason: "signature_verification_failed" };
  }

  // 7. Check Permit2 allowance (payer must have approved Permit2)
  try {
    const allowance = (await signer.readContract({
      address: permitted.token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [from, PERMIT2_ADDRESS],
    })) as bigint;
    if (allowance < BigInt(permitted.amount)) {
      return { isValid: false, invalidReason: "permit2_allowance_required" };
    }
  } catch {
    return { isValid: false, invalidReason: "allowance_check_failed" };
  }

  // 8. Check token balance
  try {
    const balance = (await signer.readContract({
      address: permitted.token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [from],
    })) as bigint;
    if (balance < BigInt(permitted.amount)) {
      return { isValid: false, invalidReason: "insufficient_balance" };
    }
  } catch {
    return { isValid: false, invalidReason: "balance_check_failed" };
  }

  return { isValid: true, payer: from };
}

/**
 * Shared Permit2 payload creation.
 * Both upto and exact schemes construct the same scaffold — only the proxy
 * address and witness shape differ. The scheme injects its witness fields and
 * any scheme-specific witness values (e.g. upto's `facilitator`); `to` and
 * `validAfter` are filled in here.
 */
export async function createPermit2Payload<W extends Permit2Witness>(
  signer: ClientSigner,
  requirements: PaymentRequirements,
  proxyAddress: `0x${string}`,
  witnessFields: readonly WitnessField[],
  schemeWitness: Omit<W, "to" | "validAfter">,
): Promise<{ signature: `0x${string}`; permit2Authorization: Permit2Authorization<W> }> {
  const chainId = parseChainId(requirements.network);
  const now = Math.floor(Date.now() / 1000);
  const deadline = now + requirements.maxTimeoutSeconds;
  const validAfter = now - 60; // 1 minute buffer for clock skew

  // 256-bit random nonce (Permit2 uses unordered nonces)
  const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = BigInt("0x" + Array.from(nonceBytes).map(b => b.toString(16).padStart(2, "0")).join(""));

  const witness = {
    ...schemeWitness,
    to: requirements.payTo as `0x${string}`,
    validAfter: validAfter.toString(),
  } as W;

  const message = {
    permitted: {
      token: requirements.asset as `0x${string}`,
      amount: BigInt(requirements.amount),
    },
    spender: proxyAddress,
    nonce,
    deadline: BigInt(deadline),
    witness: witnessMessage(witnessFields, witness as Record<string, string>),
  };

  const signature = await signer.signTypedData({
    domain: permit2Domain(chainId),
    types: permit2WitnessTypes(witnessFields),
    primaryType: "PermitWitnessTransferFrom",
    message,
  });

  return {
    signature,
    permit2Authorization: {
      from: signer.address,
      permitted: {
        token: requirements.asset as `0x${string}`,
        amount: requirements.amount,
      },
      spender: proxyAddress,
      nonce: nonce.toString(),
      deadline: deadline.toString(),
      witness,
    },
  };
}
