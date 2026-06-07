import { describe, it, expect } from "vitest";
import { createBudgetTracker, parsePriceUsd } from "../src/budget.js";
import { BudgetExceededError } from "../src/types.js";

describe("parsePriceUsd", () => {
  it("parses dollar-prefixed strings", () => {
    expect(parsePriceUsd("$0.10")).toBe(0.1);
    expect(parsePriceUsd("$5")).toBe(5);
  });

  it("parses raw numbers", () => {
    expect(parsePriceUsd("0.25")).toBe(0.25);
  });

  it("throws on invalid", () => {
    expect(() => parsePriceUsd("")).toThrow();
    expect(() => parsePriceUsd("abc")).toThrow();
    expect(() => parsePriceUsd("-1")).toThrow();
  });
});

describe("createBudgetTracker", () => {
  it("no-op when no budget provided", () => {
    const t = createBudgetTracker();
    expect(() => t.check("svc", 1000)).not.toThrow();
    t.record(1000);
    expect(t.spentToday()).toBe(1000); // record still tracks, check is no-op
  });

  it("allows costs under perCall cap", () => {
    const t = createBudgetTracker({ perCall: "$0.10" });
    expect(() => t.check("svc", 0.05)).not.toThrow();
    expect(() => t.check("svc", 0.1)).not.toThrow();
  });

  it("throws BudgetExceededError when perCall cap is exceeded", () => {
    const t = createBudgetTracker({ perCall: "$0.10" });
    expect(() => t.check("svc", 0.11)).toThrow(BudgetExceededError);
    try {
      t.check("svc", 0.5);
    } catch (e) {
      expect(e).toBeInstanceOf(BudgetExceededError);
      expect((e as BudgetExceededError).kind).toBe("perCall");
      expect((e as BudgetExceededError).serviceId).toBe("svc");
    }
  });

  it("throws when perDay cap is exceeded across multiple calls", () => {
    const t = createBudgetTracker({ perDay: "$1" });
    t.record(0.4);
    t.record(0.4);
    expect(() => t.check("svc", 0.3)).toThrow(BudgetExceededError);
    expect(() => t.check("svc", 0.2)).not.toThrow();
  });

  it("daily counters bucket by UTC date", () => {
    const t = createBudgetTracker({ perDay: "$1" });
    const yesterday = new Date("2024-01-01T12:00:00Z");
    const today = new Date("2024-01-02T12:00:00Z");
    t.record(0.9, yesterday);
    expect(t.spentToday(yesterday)).toBeCloseTo(0.9);
    expect(t.spentToday(today)).toBe(0);
  });
});
