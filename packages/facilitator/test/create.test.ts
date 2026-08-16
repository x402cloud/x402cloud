import { describe, it, expect, vi } from "vitest";
import { createFacilitator } from "../src/create.js";
import type { FacilitatorConfig } from "../src/types.js";
import { baseSepolia } from "viem/chains";

// Mock @x402cloud/evm
vi.mock("@x402cloud/evm", () => ({
  verifyUpto: vi.fn(async () => ({ isValid: true, payer: "0xPayer" })),
  settleUpto: vi.fn(async () => ({
    success: true,
    transaction: "0xtxhash",
    network: "eip155:84532",
    settledAmount: "5000",
  })),
  verifyExact: vi.fn(async () => ({ isValid: true, payer: "0xPayer" })),
  settleExact: vi.fn(async () => ({
    success: true,
    transaction: "0xtxhash",
    network: "eip155:84532",
    settledAmount: "10000",
  })),
  confirmSettlement: vi.fn(async () => ({
    success: true,
    transaction: "0xtxhash",
    network: "eip155:84532",
    settledAmount: "5000",
  })),
}));

// Mock viem to avoid real network calls. We keep encodeFunctionData + keccak256
// REAL (so the two-step signer's hash derivation is exercised, not faked) and
// only stub the network-touching client methods.
const sendRawTransaction = vi.fn(async () => "0xsendresult");
const prepareTransactionRequest = vi.fn(async (req: Record<string, unknown>) => ({
  ...req,
  nonce: 7,
  gas: 21000n,
  maxFeePerGas: 1n,
  maxPriorityFeePerGas: 1n,
}));
const signTransaction = vi.fn(async () => "0xserializedrawtx" as `0x${string}`);
const waitForTransactionReceipt = vi.fn(async () => ({
  status: "success",
  transactionHash: "0xtx",
}));

vi.mock("viem", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      readContract: vi.fn(),
      waitForTransactionReceipt,
      sendRawTransaction,
    })),
    createWalletClient: vi.fn(() => ({
      writeContract: vi.fn(),
      prepareTransactionRequest,
      signTransaction,
      chain: baseSepolia,
      account: { address: "0xmock" },
    })),
  };
});

// Known test private key (well-known Hardhat #0 account)
const TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as `0x${string}`;
const EXPECTED_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const testConfig: FacilitatorConfig = {
  privateKey: TEST_PRIVATE_KEY,
  rpcUrl: "https://sepolia.base.org",
  network: "eip155:84532",
  chain: baseSepolia,
};

const mockPayload = {
  signature: "0xsig" as `0x${string}`,
  permit2Authorization: {} as any,
};

const mockRequirements = {
  scheme: "upto" as const,
  network: "eip155:84532" as const,
  asset: "0xUSDC",
  amount: "10000",
  payTo: "0xRecipient",
  maxTimeoutSeconds: 300,
};

const mockExactRequirements = {
  ...mockRequirements,
  scheme: "exact" as const,
};

describe("createFacilitator", () => {
  it("returns object with correct shape", () => {
    const facilitator = createFacilitator(testConfig);

    expect(facilitator).toHaveProperty("address");
    expect(facilitator).toHaveProperty("network");
    expect(facilitator).toHaveProperty("verify");
    expect(facilitator).toHaveProperty("settle");
    expect(facilitator).toHaveProperty("verifyExact");
    expect(facilitator).toHaveProperty("settleExact");
    expect(facilitator).toHaveProperty("schemes");
    expect(typeof facilitator.verify).toBe("function");
    expect(typeof facilitator.settle).toBe("function");
    expect(typeof facilitator.verifyExact).toBe("function");
    expect(typeof facilitator.settleExact).toBe("function");
  });

  it("has scheme handlers for upto and exact", () => {
    const facilitator = createFacilitator(testConfig);

    expect(facilitator.schemes).toHaveProperty("upto");
    expect(facilitator.schemes).toHaveProperty("exact");
    expect(typeof facilitator.schemes.upto.verify).toBe("function");
    expect(typeof facilitator.schemes.upto.settle).toBe("function");
    expect(typeof facilitator.schemes.exact.verify).toBe("function");
    expect(typeof facilitator.schemes.exact.settle).toBe("function");
  });

  it("derives correct address from private key", () => {
    const facilitator = createFacilitator(testConfig);
    expect(facilitator.address.toLowerCase()).toBe(EXPECTED_ADDRESS.toLowerCase());
  });

  it("sets network from config", () => {
    const facilitator = createFacilitator(testConfig);
    expect(facilitator.network).toBe("eip155:84532");
  });

  it("verify delegates to verifyUpto", async () => {
    const { verifyUpto } = await import("@x402cloud/evm");
    const facilitator = createFacilitator(testConfig);

    const result = await facilitator.verify(mockPayload, mockRequirements);
    expect(result.isValid).toBe(true);
    expect(verifyUpto).toHaveBeenCalledWith(
      expect.anything(),
      mockPayload,
      mockRequirements,
      // The facilitator's OWN settlement address — verifyUpto fails closed on
      // any witness/requirements bound to a different facilitator.
      expect.stringMatching(new RegExp(EXPECTED_ADDRESS, 'i')),
    );
  });

  it("settle delegates to settleUpto", async () => {
    const { settleUpto } = await import("@x402cloud/evm");
    const facilitator = createFacilitator(testConfig);

    const result = await facilitator.settle(mockPayload, mockRequirements, "5000");
    expect(result.success).toBe(true);
    expect(settleUpto).toHaveBeenCalledWith(
      expect.anything(),
      mockPayload,
      mockRequirements,
      "5000",
    );
  });

  it("verifyExact delegates to verifyExact from evm", async () => {
    const { verifyExact } = await import("@x402cloud/evm");
    const facilitator = createFacilitator(testConfig);

    const result = await facilitator.verifyExact(mockPayload, mockExactRequirements);
    expect(result.isValid).toBe(true);
    expect(verifyExact).toHaveBeenCalledWith(
      expect.anything(),
      mockPayload,
      mockExactRequirements,
    );
  });

  it("settleExact delegates to settleExact from evm", async () => {
    const { settleExact } = await import("@x402cloud/evm");
    const facilitator = createFacilitator(testConfig);

    const result = await facilitator.settleExact(mockPayload, mockExactRequirements);
    expect(result.success).toBe(true);
    expect(settleExact).toHaveBeenCalledWith(
      expect.anything(),
      mockPayload,
      mockExactRequirements,
    );
  });

  it("confirm delegates to confirmSettlement from evm (one confirm for both schemes)", async () => {
    const { confirmSettlement } = await import("@x402cloud/evm");
    const facilitator = createFacilitator(testConfig);

    const result = await facilitator.confirm("0xtxhash", "eip155:84532", "5000");
    expect(result.success).toBe(true);
    expect(confirmSettlement).toHaveBeenCalledWith(expect.anything(), {
      txHash: "0xtxhash",
      network: "eip155:84532",
      settledAmount: "5000",
    });
  });

  // ── Finding 1: the built signer exposes a two-step sign/send port ─────────
  describe("built signer two-step port (Finding 1)", () => {
    // Capture the signer createFacilitator builds by reading it off the (mocked)
    // settleUpto call — settle(payload,...) calls settleUpto(signer, ...).
    async function captureSigner() {
      const { settleUpto } = await import("@x402cloud/evm");
      (settleUpto as unknown as { mock: { calls: unknown[][] } }).mock.calls.length = 0;
      const facilitator = createFacilitator(testConfig);
      await facilitator.settle(mockPayload, mockRequirements, "5000");
      const signer = (settleUpto as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as {
        signSettlementTx: (p: unknown) => Promise<{ hash: string; serialized: string }>;
        sendRawSettlementTx: (s: `0x${string}`) => Promise<void>;
        waitForTransactionReceipt: (p: { hash: `0x${string}`; timeout?: number }) => Promise<unknown>;
      };
      return signer;
    }

    it("signSettlementTx signs locally and returns keccak256(serialized) as the hash (no broadcast)", async () => {
      const { keccak256 } = await import("viem");
      const signer = await captureSigner();

      const settleAbi = [
        { type: "function", name: "settle", stateMutability: "nonpayable", inputs: [], outputs: [] },
      ] as const;
      const { hash, serialized } = await signer.signSettlementTx({
        address: "0x4020633461b2895a48930Ff97eE8fCdE8E520002",
        abi: settleAbi,
        functionName: "settle",
        args: [],
      });

      expect(serialized).toBe("0xserializedrawtx");
      expect(hash).toBe(keccak256("0xserializedrawtx"));
      // Signing must NOT broadcast — that is sendRawSettlementTx's job (Finding 1).
      expect(sendRawTransaction).not.toHaveBeenCalled();
      expect(signTransaction).toHaveBeenCalledTimes(1);
    });

    it("sendRawSettlementTx broadcasts the already-signed raw tx via sendRawTransaction", async () => {
      const signer = await captureSigner();
      sendRawTransaction.mockClear();

      await signer.sendRawSettlementTx("0xserializedrawtx");

      expect(sendRawTransaction).toHaveBeenCalledWith({ serializedTransaction: "0xserializedrawtx" });
    });

    it("waitForTransactionReceipt threads the bounded timeout to viem (Finding 2)", async () => {
      const signer = await captureSigner();
      waitForTransactionReceipt.mockClear();

      await signer.waitForTransactionReceipt({ hash: "0xtx", timeout: 60_000 });

      expect(waitForTransactionReceipt).toHaveBeenCalledWith(
        expect.objectContaining({ hash: "0xtx", timeout: 60_000 }),
      );
    });
  });

  describe("network mismatch guard", () => {
    it("verify rejects payload with different network", async () => {
      const facilitator = createFacilitator(testConfig); // configured for eip155:84532
      const result = await facilitator.verify(mockPayload, {
        ...mockRequirements,
        network: "eip155:1" as const, // Ethereum mainnet
      });
      expect(result.isValid).toBe(false);
      if (!result.isValid) expect(result.invalidReason).toBe("network_mismatch");
    });

    it("settle rejects payload with different network", async () => {
      const facilitator = createFacilitator(testConfig);
      const result = await facilitator.settle(
        mockPayload,
        { ...mockRequirements, network: "eip155:1" as const },
        "5000",
      );
      expect(result.success).toBe(false);
      if (!result.success) expect(result.errorReason).toBe("network_mismatch");
    });

    it("verifyExact rejects payload with different network", async () => {
      const facilitator = createFacilitator(testConfig);
      const result = await facilitator.verifyExact(mockPayload, {
        ...mockExactRequirements,
        network: "eip155:1" as const,
      });
      expect(result.isValid).toBe(false);
    });
  });

  describe("RPC URL validation", () => {
    it("rejects RPC URL with non-http(s) protocol", () => {
      expect(() =>
        createFacilitator({ ...testConfig, rpcUrl: "ftp://example.com" }),
      ).toThrow(/http\(s\)/);
    });

    it("rejects http:// for non-localhost", () => {
      expect(() =>
        createFacilitator({ ...testConfig, rpcUrl: "http://attacker.example/" }),
      ).toThrow(/localhost/);
    });

    it("allows http://localhost for local dev nodes", () => {
      expect(() =>
        createFacilitator({ ...testConfig, rpcUrl: "http://localhost:8545" }),
      ).not.toThrow();
    });

    it("rejects RPC URL with embedded credentials", () => {
      expect(() =>
        createFacilitator({ ...testConfig, rpcUrl: "https://user:pass@rpc.example/" }),
      ).toThrow(/credentials/);
    });

    it("rejects garbage RPC URL", () => {
      expect(() =>
        createFacilitator({ ...testConfig, rpcUrl: "not-a-url" }),
      ).toThrow(/Invalid/);
    });
  });
});
