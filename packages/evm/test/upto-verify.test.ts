import { describe, it, expect, vi } from "vitest";
import { verifyUpto } from "../src/upto/verify.js";
import { X402_UPTO_PROXY } from "../src/constants.js";
import type { FacilitatorSigner, UptoPayload } from "../src/types.js";
import type { PaymentRequirements } from "@x402cloud/protocol";

const PAY_TO = "0x207C6D8f63Bf01F70dc6D372693E8D5943848E88" as const;
const PAYER = "0x1111111111111111111111111111111111111111" as const;
const TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const FACILITATOR = "0x9999999999999999999999999999999999999999" as const;

function makeRequirements(overrides?: Partial<PaymentRequirements>): PaymentRequirements {
  return {
    scheme: "upto",
    network: "eip155:8453",
    asset: TOKEN,
    maxAmount: "100000",
    payTo: PAY_TO,
    maxTimeoutSeconds: 300,
    extra: { facilitator: FACILITATOR },
    ...overrides,
  };
}

function makePayload(overrides?: {
  spender?: `0x${string}`;
  to?: `0x${string}`;
  deadline?: string;
  validAfter?: string;
  amount?: string;
  facilitator?: `0x${string}`;
}): UptoPayload {
  const now = Math.floor(Date.now() / 1000);
  return {
    signature: "0xdeadbeef",
    permit2Authorization: {
      from: PAYER,
      permitted: {
        token: TOKEN,
        amount: overrides?.amount ?? "100000",
      },
      spender: overrides?.spender ?? X402_UPTO_PROXY,
      nonce: "12345",
      deadline: overrides?.deadline ?? (now + 600).toString(),
      witness: {
        to: overrides?.to ?? PAY_TO,
        facilitator: overrides?.facilitator ?? FACILITATOR,
        validAfter: overrides?.validAfter ?? (now - 60).toString(),
      },
    },
  };
}

function makeSigner(overrides?: {
  verifyTypedData?: boolean;
  allowance?: bigint;
  balance?: bigint;
}): FacilitatorSigner {
  return {
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === "allowance") return overrides?.allowance ?? BigInt("1000000");
      if (functionName === "balanceOf") return overrides?.balance ?? BigInt("1000000");
      return 0n;
    }),
    verifyTypedData: vi.fn(async () => overrides?.verifyTypedData ?? true),
    writeContract: vi.fn(async () => "0xtxhash" as `0x${string}`),
    waitForTransactionReceipt: vi.fn(async () => ({
      status: "success" as const,
      transactionHash: "0xtxhash" as `0x${string}`,
    })),
  };
}

describe("verifyUpto", () => {
  it("rejects invalid spender", async () => {
    const result = await verifyUpto(
      makeSigner(),
      makePayload({ spender: "0x0000000000000000000000000000000000000000" }),
      makeRequirements(),
      FACILITATOR,
    );
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("invalid_spender");
  });

  it("rejects wrong recipient", async () => {
    const result = await verifyUpto(
      makeSigner(),
      makePayload({ to: "0x0000000000000000000000000000000000000001" }),
      makeRequirements(),
      FACILITATOR,
    );
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("invalid_recipient");
  });

  it("rejects expired deadline", async () => {
    const result = await verifyUpto(
      makeSigner(),
      makePayload({ deadline: "0" }),
      makeRequirements(),
      FACILITATOR,
    );
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("deadline_expired");
  });

  it("rejects not-yet-valid (validAfter in future)", async () => {
    const future = (Math.floor(Date.now() / 1000) + 3600).toString();
    const result = await verifyUpto(
      makeSigner(),
      makePayload({ validAfter: future }),
      makeRequirements(),
      FACILITATOR,
    );
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("not_yet_valid");
  });

  it("rejects insufficient authorized amount", async () => {
    const result = await verifyUpto(
      makeSigner(),
      makePayload({ amount: "1" }),
      makeRequirements({ maxAmount: "100000" }),
      FACILITATOR,
    );
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("insufficient_authorized_amount");
  });

  it("rejects invalid signature", async () => {
    const result = await verifyUpto(
      makeSigner({ verifyTypedData: false }),
      makePayload(),
      makeRequirements(),
      FACILITATOR,
    );
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("invalid_signature");
  });

  it("rejects insufficient Permit2 allowance", async () => {
    const result = await verifyUpto(
      makeSigner({ verifyTypedData: true, allowance: 0n }),
      makePayload(),
      makeRequirements(),
      FACILITATOR,
    );
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("permit2_allowance_required");
  });

  it("rejects insufficient balance", async () => {
    const result = await verifyUpto(
      makeSigner({ verifyTypedData: true, allowance: BigInt("1000000"), balance: 0n }),
      makePayload(),
      makeRequirements(),
      FACILITATOR,
    );
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("insufficient_balance");
  });

  it("rejects when requirements.extra.facilitator is missing (fail closed)", async () => {
    const result = await verifyUpto(
      makeSigner(),
      makePayload(),
      makeRequirements({ extra: undefined }),
      FACILITATOR,
    );
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("facilitator_mismatch");
  });

  it("rejects when advertised facilitator is not our address (fail closed)", async () => {
    const result = await verifyUpto(
      makeSigner(),
      makePayload(),
      makeRequirements({ extra: { facilitator: "0x1234567890123456789012345678901234567890" } }),
      FACILITATOR,
    );
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("facilitator_mismatch");
  });

  it("rejects when the signed witness binds a different facilitator", async () => {
    const result = await verifyUpto(
      makeSigner(),
      makePayload({ facilitator: "0x1234567890123456789012345678901234567890" }),
      makeRequirements(),
      FACILITATOR,
    );
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("invalid_facilitator");
  });

  it("accepts facilitator addresses differing only in case", async () => {
    const result = await verifyUpto(
      makeSigner(),
      makePayload(),
      makeRequirements(),
      FACILITATOR.toUpperCase().replace("0X", "0x") as `0x${string}`,
    );
    expect(result.isValid).toBe(true);
  });

  it("passes with all valid data", async () => {
    const result = await verifyUpto(
      makeSigner(),
      makePayload(),
      makeRequirements(),
      FACILITATOR,
    );
    expect(result.isValid).toBe(true);
    expect(result.payer).toBe(PAYER);
  });
});
