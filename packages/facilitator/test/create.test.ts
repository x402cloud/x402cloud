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
}));

// Mock viem to avoid real network calls
vi.mock("viem", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      readContract: vi.fn(),
      waitForTransactionReceipt: vi.fn(),
    })),
    createWalletClient: vi.fn(() => ({
      writeContract: vi.fn(),
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
  maxAmount: "10000",
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
});
