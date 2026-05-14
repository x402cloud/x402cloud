import { MAX_DURATION_MS } from "./pricing.js";

/** Supported runtimes. Add a new language by adding a row, not by branching. */
export type Runtime = "python" | "node";

export type RuntimeConfig = {
  /** `language` value passed to the Sandbox SDK code interpreter. */
  language: "python" | "javascript";
};

export const RUNTIMES: Readonly<Record<Runtime, RuntimeConfig>> = Object.freeze({
  python: { language: "python" },
  node:   { language: "javascript" },
});

export type ExecRequest = {
  code: string;
  timeout?: number;
  stdin?: string;
};

export type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
};

export type SandboxBinding = {
  /** Durable Object namespace exposing the @cloudflare/sandbox Sandbox class. */
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
};

/**
 * Minimal shape we rely on from the SDK. Keeps this module testable without
 * having to spin a real container — anything we wire here is a function call,
 * not a class hierarchy.
 */
export type SandboxLike = {
  runCode(
    code: string,
    opts: { language: "python" | "javascript"; timeout?: number },
  ): Promise<{
    logs?: { stdout?: string[]; stderr?: string[] };
    text?: string;
    error?: { value?: string };
    exitCode?: number;
  }>;
};

export type RunDeps = {
  /** Resolves a Sandbox instance for the caller. Injected for testability. */
  getSandbox: (binding: SandboxBinding, id: string) => SandboxLike;
  /** Wall-clock source, injectable for tests. */
  now: () => number;
};

export class SandboxTimeoutError extends Error {
  constructor(public readonly durationMs: number) {
    super("sandbox-timeout");
  }
}

/**
 * Pure-ish entry point: takes (binding, runtime, body, deps) and returns the
 * canonical `ExecResult`. The only side effect is calling into the injected
 * sandbox. No globals, no module state.
 */
export async function runCode(
  binding: SandboxBinding,
  runtime: Runtime,
  body: ExecRequest,
  sandboxId: string,
  deps: RunDeps,
): Promise<ExecResult> {
  const config = RUNTIMES[runtime];
  if (!config) throw new Error(`Unknown runtime: ${runtime}`);

  const requested = typeof body.timeout === "number" ? body.timeout : 10_000;
  const timeout = Math.max(0, Math.min(requested, MAX_DURATION_MS));

  const sandbox = deps.getSandbox(binding, sandboxId);
  const start = deps.now();

  let result: Awaited<ReturnType<SandboxLike["runCode"]>>;
  try {
    result = await sandbox.runCode(body.code, { language: config.language, timeout });
  } catch (e) {
    const durationMs = deps.now() - start;
    const msg = e instanceof Error ? e.message.toLowerCase() : "";
    if (msg.includes("timeout") || msg.includes("timed out")) {
      throw new SandboxTimeoutError(durationMs);
    }
    throw e;
  }

  const durationMs = deps.now() - start;
  const stdout = (result.logs?.stdout ?? []).join("") || result.text || "";
  const stderr = (result.logs?.stderr ?? []).join("") || result.error?.value || "";
  const exitCode = typeof result.exitCode === "number"
    ? result.exitCode
    : result.error
      ? 1
      : 0;

  return { stdout, stderr, exitCode, durationMs };
}

/**
 * Build a production `RunDeps` whose `getSandbox` lazily imports the
 * `@cloudflare/sandbox` SDK on first use and memoises the loader inside a
 * closure — no module-level mutable state.
 *
 * Call this once per isolate inside `createApp(env)`.
 */
export function createDefaultRunDeps(): RunDeps {
  let getSandboxFn: ((binding: unknown, id: string) => SandboxLike) | null = null;
  let loadPromise: Promise<(binding: unknown, id: string) => SandboxLike> | null = null;

  async function load(): Promise<(binding: unknown, id: string) => SandboxLike> {
    if (getSandboxFn) return getSandboxFn;
    if (!loadPromise) {
      loadPromise = (async () => {
        const mod = (await import("@cloudflare/sandbox")) as {
          getSandbox: (binding: unknown, id: string) => unknown;
        };
        const fn = (binding: unknown, id: string) =>
          mod.getSandbox(binding, id) as SandboxLike;
        getSandboxFn = fn;
        return fn;
      })();
    }
    return loadPromise;
  }

  return {
    getSandbox: (binding, id) => {
      if (!getSandboxFn) {
        throw new Error(
          "Sandbox SDK not initialised — await initRunDeps(deps) before runCode()",
        );
      }
      return getSandboxFn(binding, id);
    },
    now: () => Date.now(),
    // Attach the loader as a non-enumerable property so initRunDeps can find
    // it without widening the public RunDeps shape (which is the
    // dependency-injection surface tests use).
    ...({ __load: load } as object),
  } as RunDeps;
}

/**
 * Eagerly resolve the lazy SDK loader for a `RunDeps` produced by
 * `createDefaultRunDeps`. No-op for test deps that don't carry a loader.
 */
export async function initRunDeps(deps: RunDeps): Promise<void> {
  const load = (deps as unknown as { __load?: () => Promise<unknown> }).__load;
  if (typeof load === "function") {
    await load();
  }
}
