import { describe, it, expect } from "vitest";
import { buildRoutes, NETWORK_MAP, SERVER_ADDRESS, HANDLERS } from "../src/index.js";
import { MODELS } from "../src/models.js";

describe("NETWORK_MAP", () => {
  it("maps base to mainnet chain ID", () => {
    expect(NETWORK_MAP["base"]).toBe("eip155:8453");
  });

  it("maps base-sepolia to testnet chain ID", () => {
    expect(NETWORK_MAP["base-sepolia"]).toBe("eip155:84532");
  });
});

describe("buildRoutes", () => {
  it("generates a route for each model", () => {
    const routes = buildRoutes("eip155:8453");
    const modelNames = Object.keys(MODELS);
    for (const name of modelNames) {
      const key = `POST /${name}`;
      expect(routes[key], `missing route for ${name}`).toBeDefined();
    }
  });

  it("routes have correct shape", () => {
    const routes = buildRoutes("eip155:8453");
    const first = Object.values(routes)[0];
    expect(first).toHaveProperty("network", "eip155:8453");
    expect(first).toHaveProperty("maxPrice");
    expect(first).toHaveProperty("payTo", SERVER_ADDRESS);
    expect(first).toHaveProperty("maxTimeoutSeconds");
    expect(first).toHaveProperty("description");
    expect(first).toHaveProperty("meter");
  });
});

describe("HANDLERS", () => {
  it("has handler for each model type", () => {
    expect(HANDLERS).toHaveProperty("text");
    expect(HANDLERS).toHaveProperty("embed");
    expect(HANDLERS).toHaveProperty("image");
  });
});

describe("SERVER_ADDRESS", () => {
  it("is a valid Ethereum address", () => {
    expect(SERVER_ADDRESS).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});
