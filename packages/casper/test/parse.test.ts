import { describe, it, expect } from "vitest";
import { parseCasperExactPayload } from "../src/parse.js";

const validPayload = () => ({
  signature: "01" + "ab".repeat(32),
  authorization: {
    from: "01" + "cd".repeat(32),
    to: "account-hash-" + "ef".repeat(32),
    value: "2500000000",
    asset: "hash-wcspr",
    network: "casper:casper-test",
    nonce: "nonce-1",
    deadline: "1900000000",
    validAfter: "1800000000",
  },
});

describe("parseCasperExactPayload", () => {
  it("accepts a well-formed payload", () => {
    const parsed = parseCasperExactPayload(validPayload());
    expect(parsed).not.toBeNull();
    expect(parsed!.authorization.value).toBe("2500000000");
    expect(parsed!.authorization.network).toBe("casper:casper-test");
  });

  it("strips unknown fields (no prototype smuggling through the boundary)", () => {
    const parsed = parseCasperExactPayload({
      ...validPayload(),
      extra: "ignored",
      authorization: { ...validPayload().authorization, extra: "ignored" },
    });
    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed!)).toEqual(["signature", "authorization"]);
    expect(Object.keys(parsed!.authorization).sort()).toEqual([
      "asset",
      "deadline",
      "from",
      "network",
      "nonce",
      "to",
      "validAfter",
      "value",
    ]);
  });

  it("rejects non-objects", () => {
    expect(parseCasperExactPayload(null)).toBeNull();
    expect(parseCasperExactPayload("string")).toBeNull();
    expect(parseCasperExactPayload(42)).toBeNull();
    expect(parseCasperExactPayload(undefined)).toBeNull();
  });

  it("rejects a missing or empty signature", () => {
    const p = validPayload() as Record<string, unknown>;
    delete p.signature;
    expect(parseCasperExactPayload(p)).toBeNull();
    expect(parseCasperExactPayload({ ...validPayload(), signature: "" })).toBeNull();
  });

  it("rejects a missing authorization", () => {
    expect(parseCasperExactPayload({ signature: "01ab" })).toBeNull();
    expect(parseCasperExactPayload({ signature: "01ab", authorization: null })).toBeNull();
  });

  it.each(["from", "to", "asset", "nonce"])("rejects a missing %s", (field) => {
    const p = validPayload();
    delete (p.authorization as Record<string, unknown>)[field];
    expect(parseCasperExactPayload(p)).toBeNull();
  });

  it("rejects a non-Casper network", () => {
    const p = validPayload();
    p.authorization.network = "eip155:8453";
    expect(parseCasperExactPayload(p)).toBeNull();
  });

  it("rejects a zero or negative value", () => {
    const zero = validPayload();
    zero.authorization.value = "0";
    expect(parseCasperExactPayload(zero)).toBeNull();

    const negative = validPayload();
    negative.authorization.value = "-1";
    expect(parseCasperExactPayload(negative)).toBeNull();
  });

  it("rejects a fractional value — motes are indivisible", () => {
    const p = validPayload();
    p.authorization.value = "2.5";
    expect(parseCasperExactPayload(p)).toBeNull();
  });

  it("rejects the parseInt-overflow deadline", () => {
    const p = validPayload();
    p.authorization.deadline = "999999999999999999999";
    expect(parseCasperExactPayload(p)).toBeNull();
  });

  it("rejects a validAfter at or after the deadline", () => {
    const equal = validPayload();
    equal.authorization.validAfter = equal.authorization.deadline;
    expect(parseCasperExactPayload(equal)).toBeNull();

    const inverted = validPayload();
    inverted.authorization.validAfter = "1900000001";
    expect(parseCasperExactPayload(inverted)).toBeNull();
  });

  it("accepts amounts larger than Number.MAX_SAFE_INTEGER", () => {
    const p = validPayload();
    p.authorization.value = "18446744073709551615";
    expect(parseCasperExactPayload(p)?.authorization.value).toBe("18446744073709551615");
  });
});
