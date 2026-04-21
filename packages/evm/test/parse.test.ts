import { describe, it, expect } from "vitest";
import { parseUptoPayload, parseExactPayload } from "../src/parse.js";

const validPermit2Authorization = {
  from: "0x1111111111111111111111111111111111111111",
  spender: "0x2222222222222222222222222222222222222222",
  nonce: "1",
  deadline: "1700000000",
  permitted: {
    token: "0x3333333333333333333333333333333333333333",
    amount: "1000000",
  },
  witness: {
    to: "0x4444444444444444444444444444444444444444",
    validAfter: "0",
    extra: "0x00",
  },
};

const validPayload = {
  signature: "0xdeadbeef",
  permit2Authorization: validPermit2Authorization,
};

describe("parseUptoPayload", () => {
  it("accepts a well-formed payload", () => {
    const parsed = parseUptoPayload(validPayload);
    expect(parsed).toEqual(validPayload);
  });

  it("throws when input is null", () => {
    expect(() => parseUptoPayload(null)).toThrow("UptoPayload");
  });

  it("throws when input is a primitive", () => {
    expect(() => parseUptoPayload("not an object")).toThrow("UptoPayload");
  });

  it("throws when input is an array", () => {
    expect(() => parseUptoPayload([])).toThrow("UptoPayload");
  });

  it("throws when signature is missing", () => {
    const { signature: _sig, ...rest } = validPayload;
    expect(() => parseUptoPayload(rest)).toThrow("UptoPayload.signature");
  });

  it("throws when signature is not hex-prefixed", () => {
    expect(() =>
      parseUptoPayload({ ...validPayload, signature: "deadbeef" })
    ).toThrow("UptoPayload.signature");
  });

  it("throws when signature is not a string", () => {
    expect(() =>
      parseUptoPayload({ ...validPayload, signature: 123 })
    ).toThrow("UptoPayload.signature");
  });

  it("throws when permit2Authorization is missing", () => {
    expect(() => parseUptoPayload({ signature: "0xabc" })).toThrow(
      "UptoPayload.permit2Authorization"
    );
  });

  it("throws when permit2Authorization.from is not hex", () => {
    expect(() =>
      parseUptoPayload({
        ...validPayload,
        permit2Authorization: { ...validPermit2Authorization, from: "notHex" },
      })
    ).toThrow("UptoPayload.permit2Authorization.from");
  });

  it("throws when permit2Authorization.nonce is not a string", () => {
    expect(() =>
      parseUptoPayload({
        ...validPayload,
        permit2Authorization: { ...validPermit2Authorization, nonce: 1 },
      })
    ).toThrow("UptoPayload.permit2Authorization.nonce");
  });

  it("throws when permitted subobject is missing", () => {
    const { permitted: _p, ...restAuth } = validPermit2Authorization;
    expect(() =>
      parseUptoPayload({
        ...validPayload,
        permit2Authorization: restAuth,
      })
    ).toThrow("UptoPayload.permit2Authorization.permitted");
  });

  it("throws when permitted.token is not hex", () => {
    expect(() =>
      parseUptoPayload({
        ...validPayload,
        permit2Authorization: {
          ...validPermit2Authorization,
          permitted: { token: "bad", amount: "100" },
        },
      })
    ).toThrow("UptoPayload.permit2Authorization.permitted.token");
  });

  it("throws when permitted.amount is not a string", () => {
    expect(() =>
      parseUptoPayload({
        ...validPayload,
        permit2Authorization: {
          ...validPermit2Authorization,
          permitted: { token: validPermit2Authorization.permitted.token, amount: 100 },
        },
      })
    ).toThrow("UptoPayload.permit2Authorization.permitted.amount");
  });

  it("throws when witness is missing", () => {
    const { witness: _w, ...restAuth } = validPermit2Authorization;
    expect(() =>
      parseUptoPayload({
        ...validPayload,
        permit2Authorization: restAuth,
      })
    ).toThrow("UptoPayload.permit2Authorization.witness");
  });

  it("throws when witness.to is not hex", () => {
    expect(() =>
      parseUptoPayload({
        ...validPayload,
        permit2Authorization: {
          ...validPermit2Authorization,
          witness: { ...validPermit2Authorization.witness, to: "oops" },
        },
      })
    ).toThrow("UptoPayload.permit2Authorization.witness.to");
  });

  it("throws when witness.extra is not hex", () => {
    expect(() =>
      parseUptoPayload({
        ...validPayload,
        permit2Authorization: {
          ...validPermit2Authorization,
          witness: { ...validPermit2Authorization.witness, extra: 42 },
        },
      })
    ).toThrow("UptoPayload.permit2Authorization.witness.extra");
  });
});

describe("parseExactPayload", () => {
  it("accepts a well-formed payload", () => {
    const parsed = parseExactPayload(validPayload);
    expect(parsed).toEqual(validPayload);
  });

  it("throws with ExactPayload prefix on bad signature", () => {
    expect(() =>
      parseExactPayload({ ...validPayload, signature: "nope" })
    ).toThrow("ExactPayload.signature");
  });

  it("throws with ExactPayload prefix on missing permit2Authorization", () => {
    expect(() => parseExactPayload({ signature: "0xabc" })).toThrow(
      "ExactPayload.permit2Authorization"
    );
  });

  it("throws when input is null", () => {
    expect(() => parseExactPayload(null)).toThrow("ExactPayload");
  });
});
