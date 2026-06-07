import { describe, it, expect, vi } from "vitest";
import { confirmSettlement } from "../src/confirm.js";
import { SETTLEMENT_RECEIPT_TIMEOUT_MS } from "../src/constants.js";
import type { FacilitatorSigner } from "../src/types.js";
import type { Network } from "@x402cloud/protocol";

const TX_HASH = "0xabc123def456" as `0x${string}`;
const NETWORK: Network = "eip155:8453";

function signer(overrides?: {
  receiptStatus?: "success" | "reverted";
  receiptThrows?: boolean;
}): Pick<FacilitatorSigner, "waitForTransactionReceipt"> {
  return {
    waitForTransactionReceipt: vi.fn(async () => {
      if (overrides?.receiptThrows) throw new Error("receipt timeout");
      return {
        status: overrides?.receiptStatus ?? ("success" as const),
        transactionHash: TX_HASH,
      };
    }),
  };
}

describe("confirmSettlement", () => {
  it("maps a successful receipt to a settled success carrying the txHash + amount", async () => {
    const result = await confirmSettlement(signer(), {
      txHash: TX_HASH,
      network: NETWORK,
      settledAmount: "5000",
    });
    expect(result).toEqual({
      success: true,
      transaction: TX_HASH,
      network: NETWORK,
      settledAmount: "5000",
    });
  });

  it("maps a reverted receipt to transaction_reverted:<hash> (DEFINITIVE)", async () => {
    const result = await confirmSettlement(signer({ receiptStatus: "reverted" }), {
      txHash: TX_HASH,
      network: NETWORK,
      settledAmount: "5000",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorReason).toBe(`transaction_reverted: ${TX_HASH}`);
    }
  });

  it("maps a thrown receipt lookup to settlement_pending_receipt:<hash> (UNKNOWN, never re-broadcast)", async () => {
    const result = await confirmSettlement(signer({ receiptThrows: true }), {
      txHash: TX_HASH,
      network: NETWORK,
      settledAmount: "5000",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorReason).toBe(`settlement_pending_receipt: ${TX_HASH}`);
    }
  });

  it("passes the bounded receipt timeout (Finding 2) so the wait stays below the in_flight lease", async () => {
    const s = signer();
    await confirmSettlement(s, { txHash: TX_HASH, network: NETWORK, settledAmount: "5000" });
    expect(s.waitForTransactionReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ hash: TX_HASH, timeout: SETTLEMENT_RECEIPT_TIMEOUT_MS }),
    );
  });
});
