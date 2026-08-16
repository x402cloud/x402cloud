export type ProbeStatus = "pass" | "fail" | "warn" | "skip";

export type ProbeResult = {
  name: string;
  status: ProbeStatus;
  latencyMs: number;
  error?: string;
  meta?: Record<string, unknown>;
};

export type ProbeReport = {
  target: string;
  timestamp: string;
  results: ProbeResult[];
  summary: { pass: number; fail: number; warn: number; skip: number };
};

export type Target = {
  name: string;
  rpc: string;
  facilitator: string | null;
  infer: string | null;
  network: string;
  facilitatorAddress?: string;
  /** The operator/revenue address that accumulates settled USDC. Defaults
   * to the facilitator's own address when unset (see `resolveFacilitatorAddress`). */
  operatorAddress?: string;
};

export type Probe = (target: Target) => Promise<ProbeResult>;
