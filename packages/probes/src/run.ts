import type { Probe, ProbeReport, ProbeResult, Target } from "./types.js";

export async function runProbes(probes: Probe[], target: Target): Promise<ProbeReport> {
  const results = await Promise.allSettled(probes.map((p) => p(target)));

  const probeResults: ProbeResult[] = results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      name: `probe-${i}`,
      status: "fail" as const,
      latencyMs: 0,
      error: r.reason?.message ?? "Unknown error",
    };
  });

  const summary = {
    pass: probeResults.filter((r) => r.status === "pass").length,
    fail: probeResults.filter((r) => r.status === "fail").length,
    warn: probeResults.filter((r) => r.status === "warn").length,
    skip: probeResults.filter((r) => r.status === "skip").length,
  };

  return {
    target: target.name,
    timestamp: new Date().toISOString(),
    results: probeResults,
    summary,
  };
}
