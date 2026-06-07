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

describe("parseUptoPayload — hardened input validation", () => {
  // --- signatures (variable length, hex content enforced) ---

  it("accepts a lowercase hex signature", () => {
    expect(() =>
      parseUptoPayload({ ...validPayload, signature: "0xabcdef0123456789" })
    ).not.toThrow();
  });

  it("accepts an uppercase hex signature", () => {
    expect(() =>
      parseUptoPayload({ ...validPayload, signature: "0xABCDEF0123456789" })
    ).not.toThrow();
  });

  it("accepts a mixed-case hex signature", () => {
    expect(() =>
      parseUptoPayload({ ...validPayload, signature: "0xAbCdEf0123456789" })
    ).not.toThrow();
  });

  it("accepts a full-length 65-byte ECDSA signature", () => {
    const sig = `0x${"a1".repeat(65)}`;
    expect(() =>
      parseUptoPayload({ ...validPayload, signature: sig })
    ).not.toThrow();
  });

  it("throws when signature has non-hex characters (0xZZZZ)", () => {
    expect(() =>
      parseUptoPayload({ ...validPayload, signature: "0xZZZZ" })
    ).toThrow("UptoPayload.signature");
  });

  it("throws when signature has a trailing non-hex char", () => {
    expect(() =>
      parseUptoPayload({ ...validPayload, signature: "0xdeadbeeg" })
    ).toThrow("UptoPayload.signature");
  });

  it("throws when signature has internal whitespace", () => {
    expect(() =>
      parseUptoPayload({ ...validPayload, signature: "0xdead beef" })
    ).toThrow("UptoPayload.signature");
  });

  // --- addresses (fixed 20-byte length, hex content enforced) ---

  it("accepts checksummed (mixed-case) addresses", () => {
    expect(() =>
      parseUptoPayload({
        ...validPayload,
        permit2Authorization: {
          ...validPermit2Authorization,
          from: "0xAbCdEf0123456789abcdef0123456789ABCDEF01",
        },
      })
    ).not.toThrow();
  });

  it("throws when an address has non-hex characters", () => {
    expect(() =>
      parseUptoPayload({
        ...validPayload,
        permit2Authorization: {
          ...validPermit2Authorization,
          from: "0xZZZZ111111111111111111111111111111111111",
        },
      })
    ).toThrow("UptoPayload.permit2Authorization.from");
  });

  it("throws when an address is too short", () => {
    expect(() =>
      parseUptoPayload({
        ...validPayload,
        permit2Authorization: { ...validPermit2Authorization, from: "0x1234" },
      })
    ).toThrow("UptoPayload.permit2Authorization.from");
  });

  it("throws when an address is too long", () => {
    expect(() =>
      parseUptoPayload({
        ...validPayload,
        permit2Authorization: {
          ...validPermit2Authorization,
          spender: "0x22222222222222222222222222222222222222220000",
        },
      })
    ).toThrow("UptoPayload.permit2Authorization.spender");
  });

  // --- numeric string fields (strict decimal-integer) ---

  it("accepts a large uint256 decimal amount", () => {
    expect(() =>
      parseUptoPayload({
        ...validPayload,
        permit2Authorization: {
          ...validPermit2Authorization,
          permitted: {
            token: validPermit2Authorization.permitted.token,
            amount: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
          },
        },
      })
    ).not.toThrow();
  });

  it("accepts zero for validAfter", () => {
    expect(() =>
      parseUptoPayload({
        ...validPayload,
        permit2Authorization: {
          ...validPermit2Authorization,
          witness: { ...validPermit2Authorization.witness, validAfter: "0" },
        },
      })
    ).not.toThrow();
  });

  it("throws when amount is in exponential notation (1.5e10)", () => {
    expect(() =>
      parseUptoPayload({
        ...validPayload,
        permit2Authorization: {
          ...validPermit2Authorization,
          permitted: { token: validPermit2Authorization.permitted.token, amount: "1.5e10" },
        },
      })
    ).toThrow("UptoPayload.permit2Authorization.permitted.amount");
  });

  it("throws when amount has a decimal point", () => {
    expect(() =>
      parseUptoPayload({
        ...validPayload,
        permit2Authorization: {
          ...validPermit2Authorization,
          permitted: { token: validPermit2Authorization.permitted.token, amount: "100.5" },
        },
      })
    ).toThrow("UptoPayload.permit2Authorization.permitted.amount");
  });

  it("throws when amount is non-numeric (abc)", () => {
    expect(() =>
      parseUptoPayload({
        ...validPayload,
        permit2Authorization: {
          ...validPermit2Authorization,
          permitted: { token: validPermit2Authorization.permitted.token, amount: "abc" },
        },
      })
    ).toThrow("UptoPayload.permit2Authorization.permitted.amount");
  });

  it("throws when amount is empty string", () => {
    expect(() =>
      parseUptoPayload({
        ...validPayload,
        permit2Authorization: {
          ...validPermit2Authorization,
          permitted: { token: validPermit2Authorization.permitted.token, amount: "" },
        },
      })
    ).toThrow("UptoPayload.permit2Authorization.permitted.amount");
  });

  it("throws when amount is negative", () => {
    expect(() =>
      parseUptoPayload({
        ...validPayload,
        permit2Authorization: {
          ...validPermit2Authorization,
          permitted: { token: validPermit2Authorization.permitted.token, amount: "-100" },
        },
      })
    ).toThrow("UptoPayload.permit2Authorization.permitted.amount");
  });

  it("throws when amount is hex-prefixed", () => {
    expect(() =>
      parseUptoPayload({
        ...validPayload,
        permit2Authorization: {
          ...validPermit2Authorization,
          permitted: { token: validPermit2Authorization.permitted.token, amount: "0x10" },
        },
      })
    ).toThrow("UptoPayload.permit2Authorization.permitted.amount");
  });

  it("throws when nonce is non-numeric", () => {
    expect(() =>
      parseUptoPayload({
        ...validPayload,
        permit2Authorization: { ...validPermit2Authorization, nonce: "not-a-number" },
      })
    ).toThrow("UptoPayload.permit2Authorization.nonce");
  });

  it("throws when deadline has whitespace", () => {
    expect(() =>
      parseUptoPayload({
        ...validPayload,
        permit2Authorization: { ...validPermit2Authorization, deadline: " 1700000000" },
      })
    ).toThrow("UptoPayload.permit2Authorization.deadline");
  });

  it("throws when validAfter is non-numeric", () => {
    expect(() =>
      parseUptoPayload({
        ...validPayload,
        permit2Authorization: {
          ...validPermit2Authorization,
          witness: { ...validPermit2Authorization.witness, validAfter: "soon" },
        },
      })
    ).toThrow("UptoPayload.permit2Authorization.witness.validAfter");
  });

  // --- witness.extra remains variable-length hex ---

  it("accepts an empty witness.extra (0x)", () => {
    expect(() =>
      parseUptoPayload({
        ...validPayload,
        permit2Authorization: {
          ...validPermit2Authorization,
          witness: { ...validPermit2Authorization.witness, extra: "0x" },
        },
      })
    ).not.toThrow();
  });

  it("accepts a longer witness.extra hex blob", () => {
    expect(() =>
      parseUptoPayload({
        ...validPayload,
        permit2Authorization: {
          ...validPermit2Authorization,
          witness: { ...validPermit2Authorization.witness, extra: "0xdeadbeefcafef00d" },
        },
      })
    ).not.toThrow();
  });

  it("throws when witness.extra has non-hex characters", () => {
    expect(() =>
      parseUptoPayload({
        ...validPayload,
        permit2Authorization: {
          ...validPermit2Authorization,
          witness: { ...validPermit2Authorization.witness, extra: "0xnothex" },
        },
      })
    ).toThrow("UptoPayload.permit2Authorization.witness.extra");
  });
});

describe("parseExactPayload — hardened input validation", () => {
  it("throws on a non-hex signature (0xZZZZ)", () => {
    expect(() =>
      parseExactPayload({ ...validPayload, signature: "0xZZZZ" })
    ).toThrow("ExactPayload.signature");
  });

  it("throws on an exponential amount", () => {
    expect(() =>
      parseExactPayload({
        ...validPayload,
        permit2Authorization: {
          ...validPermit2Authorization,
          permitted: { token: validPermit2Authorization.permitted.token, amount: "1e9" },
        },
      })
    ).toThrow("ExactPayload.permit2Authorization.permitted.amount");
  });

  it("accepts a full-length real-shaped payload", () => {
    const realisticPayload = {
      signature: `0x${"ab".repeat(65)}`,
      permit2Authorization: validPermit2Authorization,
    };
    expect(parseExactPayload(realisticPayload)).toEqual(realisticPayload);
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
