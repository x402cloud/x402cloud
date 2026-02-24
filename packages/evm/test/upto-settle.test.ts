import { describe, it, expect, vi } from "vitest";
import { settleUpto } from "../src/upto/settle.js";
import { X402_UPTO_PROXY } from "../src/constants.js";
import type { FacilitatorSigner, UptoPayload } from "../src/types.js";
import type { PaymentRequirements } from "@x402cloud/protocol";

const PAY_TO = "0x207C6D8f63Bf01F70dc6D372693E8D5943848E88" as const;
const PAYER = "0x1111111111111111111111111111111111111111" as const;
const TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const TX_HASH = "0xabc123def456" as `0x${string}`;

function makeRequirements(): PaymentRequirements {
  return {
    scheme: "upto",
    network: "eip155:8453",
    asset: TOKEN,
    maxAmount: "100000",
    payTo: PAY_TO,
    maxTimeoutSeconds: 300,
  };
}

function makePayload(): UptoPayload {
  const now = Math.floor(Date.now() / 1000);
  return {
    signature: "0xdeadbeef",
    permit2Authorization: {
      from: PAYER,
      permitted: {
        token: TOKEN,
        amount: "100000",
      },
      spender: X402_UPTO_PROXY,
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
}): FacilitatorSigner {
  return {
    readContract: vi.fn(async () => BigInt("1000000")),
    verifyTypedData: vi.fn(async () => overrides?.verifyTypedData ?? true),
    writeContract: vi.fn(async () => TX_HASH),
    waitForTransactionReceipt: vi.fn(async () => ({
      status: overrides?.receiptStatus ?? ("success" as const),
      transactionHash: TX_HASH,
    })),
  };
}

describe("settleUpto", () => {
  it("rejects if settlementAmount > authorized amount", async () => {
    const result = await settleUpto(
      makeSigner(),
      makePayload(),
      makeRequirements(),
      "200000",
    );
    expect(result.success).toBe(false);
    expect(result.errorReason).toBe("settlement_exceeds_authorization");
  });

  it("returns success with zero settlement amount (no tx needed)", async () => {
    const signer = makeSigner();
    const result = await settleUpto(
      signer,
      makePayload(),
      makeRequirements(),
      "0",
    );
    expect(result.success).toBe(true);
    expect(result.settledAmount).toBe("0");
    expect(signer.writeContract).not.toHaveBeenCalled();
  });

  it("calls writeContract with correct proxy address and args", async () => {
    const signer = makeSigner();
    const result = await settleUpto(
      signer,
      makePayload(),
      makeRequirements(),
      "50000",
    );

    expect(result.success).toBe(true);
    expect(result.transaction).toBe(TX_HASH);
    expect(signer.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: X402_UPTO_PROXY,
        functionName: "settle",
      })
    );
  });

  it("handles reverted transaction", async () => {
    const signer = makeSigner({ receiptStatus: "reverted" });
    const result = await settleUpto(
      signer,
      makePayload(),
      makeRequirements(),
      "50000",
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorReason).toContain("transaction_reverted");
      expect(result.errorReason).toContain(TX_HASH);
    }
  });

  it("rejects tampered payload (bad signature)", async () => {
    const signer = makeSigner({ verifyTypedData: false });
    const result = await settleUpto(
      signer,
      makePayload(),
      makeRequirements(),
      "50000",
    );
    expect(result.success).toBe(false);
    expect(result.errorReason).toBe("tampered_payload");
    expect(signer.writeContract).not.toHaveBeenCalled();
  });
});
