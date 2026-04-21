import { describe, it, expect } from "vitest";
import { wrapProbe } from "../src/wrap.js";
import { runProbes } from "../src/run.js";
import type { Target } from "../src/types.js";

const target: Target = {
  name: "test-net",
  rpc: "https://example.com/rpc",
  facilitator: "https://example.com/facilitator",
  infer: "https://example.com/infer",
  network: "eip155:84532",
};

describe("wrapProbe", () => {
  it("returns the body result with measured latency and the wrapped name preserved", async () => {
    const probe = wrapProbe("my-probe", async () => ({
      name: "my-probe",
      status: "pass",
      meta: { hello: "world" },
    }));
    const result = await probe(target);
    expect(result.name).toBe("my-probe");
    expect(result.status).toBe("pass");
    expect(result.meta).toEqual({ hello: "world" });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("catches thrown errors and returns a fail result with the error message", async () => {
    const probe = wrapProbe("bad-probe", async () => {
      throw new Error("boom");
    });
    const result = await probe(target);
    expect(result.name).toBe("bad-probe");
    expect(result.status).toBe("fail");
    expect(result.error).toBe("boom");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("reports 'Unknown error' when a non-Error value is thrown", async () => {
    const probe = wrapProbe("weird-probe", async () => {
      throw "string-thrown";
    });
    const result = await probe(target);
    expect(result.status).toBe("fail");
    expect(result.error).toBe("Unknown error");
  });

  it("aborts the body via AbortSignal after timeout", async () => {
    const probe = wrapProbe(
      "slow-probe",
      async (_t, signal) => {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve(undefined), 200);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("aborted"));
          });
        });
        return { name: "slow-probe", status: "pass" };
      },
      5,
    );
    const result = await probe(target);
    expect(result.status).toBe("fail");
    expect(result.error).toBe("aborted");
  });
});

describe("runProbes", () => {
  it("aggregates results and summary counts across probes", async () => {
    const probes = [
      wrapProbe("a", async () => ({ name: "a", status: "pass" })),
      wrapProbe("b", async () => ({ name: "b", status: "fail", error: "nope" })),
      wrapProbe("c", async () => ({ name: "c", status: "warn" })),
      wrapProbe("d", async () => ({ name: "d", status: "skip" })),
    ];
    const report = await runProbes(probes, target);
    expect(report.target).toBe("test-net");
    expect(report.results).toHaveLength(4);
    expect(report.summary).toEqual({ pass: 1, fail: 1, warn: 1, skip: 1 });
    expect(() => new Date(report.timestamp).toISOString()).not.toThrow();
  });

  it("turns rejected probes into fail results with an index-based fallback name", async () => {
    // Unwrapped probe that throws bypasses wrapProbe's catch, exercising the Promise.allSettled branch.
    const throwing = async () => {
      throw new Error("rpc down");
    };
    const probes = [
      wrapProbe("ok", async () => ({ name: "ok", status: "pass" })),
      throwing as unknown as (typeof probes)[number],
    ];
    const report = await runProbes(probes as any, target);
    expect(report.results[0].status).toBe("pass");
    expect(report.results[1].status).toBe("fail");
    expect(report.results[1].name).toBe("probe-1");
    expect(report.results[1].error).toBe("rpc down");
    expect(report.summary).toEqual({ pass: 1, fail: 1, warn: 0, skip: 0 });
  });
});
