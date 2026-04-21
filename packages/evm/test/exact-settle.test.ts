import { describe, it, expect, vi } from "vitest";
import { settleExact } from "../src/exact/settle.js";
import { X402_EXACT_PROXY } from "../src/constants.js";
import type { FacilitatorSigner, ExactPayload } from "../src/types.js";
import type { PaymentRequirements } from "@x402cloud/protocol";

const PAY_TO = "0x207C6D8f63Bf01F70dc6D372693E8D5943848E88" as const;
const PAYER = "0x1111111111111111111111111111111111111111" as const;
const TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const TX_HASH = "0xabc123def456" as `0x${string}`;

function makeRequirements(): PaymentRequirements {
  return {
    scheme: "exact",
    network: "eip155:8453",
    asset: TOKEN,
    maxAmount: "100000",
    payTo: PAY_TO,
    maxTimeoutSeconds: 300,
  };
}

function makePayload(): ExactPayload {
  const now = Math.floor(Date.now() / 1000);
  return {
    signature: "0xdeadbeef",
    permit2Authorization: {
      from: PAYER,
      permitted: {
        token: TOKEN,
        amount: "100000",
      },
      spender: X402_EXACT_PROXY,
      nonce: "12345",
      deadline: (now + 600).toString(),
      witness: {
        to: PAY_TO,
        validAfter: (now - 60).toString(),
        extra: "0x",
      },
    },
  };
}

function makeSigner(overrides?: {
  receiptStatus?: "success" | "reverted";
  verifyTypedData?: boolean;
  writeContractThrows?: boolean;
  verifyTypedDataThrows?: boolean;
}): FacilitatorSigner {
  return {
    readContract: vi.fn(async () => BigInt("1000000")),
    verifyTypedData: vi.fn(async () => {
      if (overrides?.verifyTypedDataThrows) throw new Error("verify boom");
      return overrides?.verifyTypedData ?? true;
    }),
    writeContract: vi.fn(async () => {
      if (overrides?.writeContractThrows) throw new Error("rpc boom");
      return TX_HASH;
    }),
    waitForTransactionReceipt: vi.fn(async () => ({
      status: overrides?.receiptStatus ?? ("success" as const),
      transactionHash: TX_HASH,
    })),
  };
}

describe("settleExact", () => {
  it("calls writeContract with the exact proxy address and full authorized amount", async () => {
    const signer = makeSigner();
    const result = await settleExact(signer, makePayload(), makeRequirements());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.transaction).toBe(TX_HASH);
      expect(result.settledAmount).toBe("100000");
      expect(result.network).toBe("eip155:8453");
    }
    expect(signer.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: X402_EXACT_PROXY,
        functionName: "settle",
      }),
    );
  });

  it("rejects tampered payload (bad signature)", async () => {
    const signer = makeSigner({ verifyTypedData: false });
    const result = await settleExact(signer, makePayload(), makeRequirements());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorReason).toBe("tampered_payload");
    }
    expect(signer.writeContract).not.toHaveBeenCalled();
  });

  it("returns signature_check_failed when verifyTypedData throws", async () => {
    const signer = makeSigner({ verifyTypedDataThrows: true });
    const result = await settleExact(signer, makePayload(), makeRequirements());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorReason).toBe("signature_check_failed");
    }
    expect(signer.writeContract).not.toHaveBeenCalled();
  });

  it("handles reverted transaction", async () => {
    const signer = makeSigner({ receiptStatus: "reverted" });
    const result = await settleExact(signer, makePayload(), makeRequirements());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorReason).toContain("transaction_reverted");
      expect(result.errorReason).toContain(TX_HASH);
    }
  });

  it("returns settlement_failed when writeContract throws", async () => {
    const signer = makeSigner({ writeContractThrows: true });
    const result = await settleExact(signer, makePayload(), makeRequirements());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorReason).toContain("settlement_failed");
      expect(result.errorReason).toContain("rpc boom");
    }
  });
});
