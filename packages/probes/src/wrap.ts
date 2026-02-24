import type { Probe, ProbeResult, Target } from "./types.js";

type ProbeBody = (
  target: Target,
  signal: AbortSignal,
) => Promise<Omit<ProbeResult, "latencyMs">>;

export function wrapProbe(
  name: string,
  body: ProbeBody,
  timeoutMs = 10_000,
): Probe {
  return async (target: Target): Promise<ProbeResult> => {
    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = await body(target, controller.signal);
      return { ...result, latencyMs: Date.now() - start };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Unknown error";
      return { name, status: "fail", latencyMs: Date.now() - start, error: message };
    } finally {
      clearTimeout(timer);
    }
  };
}
