/**
 * Resilient fetch wrapper with retry + circuit breaker for remote facilitator calls.
 */

export type ResilientFetchConfig = {
  /** Max number of retries after initial attempt. Default: 2 */
  maxRetries?: number;
  /** Base delay in ms before first retry (exponential backoff). Default: 200 */
  retryDelayMs?: number;
  /** Number of consecutive failures before opening circuit. Default: 5 */
  circuitBreakerThreshold?: number;
  /** Time in ms before an open circuit moves to half-open. Default: 30000 */
  circuitBreakerResetMs?: number;
  /**
   * Per-request timeout in ms. After this elapses without a response, the
   * request is aborted and treated as a retryable failure. Without this,
   * a hung facilitator would tie up the caller indefinitely. Default: 10000
   */
  requestTimeoutMs?: number;
};

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreaker {
  state: CircuitState;
  failures: number;
  lastFailureTime: number;
}

/** Events that can trigger a circuit breaker state transition */
export type BreakerEvent = "success" | "failure" | "attempt";

const DEFAULTS = {
  maxRetries: 2,
  retryDelayMs: 200,
  circuitBreakerThreshold: 5,
  circuitBreakerResetMs: 30_000,
  requestTimeoutMs: 10_000,
} as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(error: unknown): boolean {
  // Network errors are always retryable
  if (error instanceof TypeError) return true;
  if (error instanceof Error && error.message.includes("fetch")) return true;
  return false; // Unknown errors are not retryable
}

function isRetryableStatus(status: number): boolean {
  return status >= 500;
}

/**
 * Pure function: compute the next circuit breaker state given the current state, an event,
 * the failure threshold, the reset window, and the current time.
 *
 * Returns a new CircuitBreaker value — never mutates the input.
 */
export function nextBreakerState(
  current: CircuitBreaker,
  event: BreakerEvent,
  threshold: number,
  resetMs: number,
  now: number,
): CircuitBreaker {
  switch (event) {
    case "success":
      return { state: "CLOSED", failures: 0, lastFailureTime: current.lastFailureTime };

    case "failure": {
      const failures = current.failures + 1;
      const state = failures >= threshold ? "OPEN" : current.state;
      return { state, failures, lastFailureTime: now };
    }

    case "attempt": {
      if (current.state === "CLOSED") {
        return current; // allowed, no change
      }
      if (current.state === "OPEN") {
        if (now - current.lastFailureTime >= resetMs) {
          // Transition to HALF_OPEN — allow one probe
          return { ...current, state: "HALF_OPEN" };
        }
        // Still open — caller should reject
        return current;
      }
      // HALF_OPEN — allow one probe, no state change
      return current;
    }
  }
}

/**
 * Creates a fetch wrapper with retry (exponential backoff) and circuit breaker.
 *
 * Circuit breaker states:
 *   CLOSED  — normal operation, requests go through
 *   OPEN    — after `circuitBreakerThreshold` consecutive failures, fast-fail all requests
 *   HALF_OPEN — after `circuitBreakerResetMs`, allow one probe request through
 *
 * Retries only on network errors and 5xx responses (not 4xx).
 *
 * Concurrency contract for the `breaker` reference:
 * `nextBreakerState` stays pure (current state + event → new state, no
 * mutation, no I/O). The mutable `breaker` variable below is the single
 * managed reference every concurrent call to the returned `resilientFetch`
 * shares. Every read-modify-write of it MUST happen as one synchronous
 * expression — `breaker = nextBreakerState(breaker, ...)` — with no
 * `await` between reading the current value and writing the computed
 * one. `applyTransition` is the only place that touches `breaker`, so
 * that invariant only has to be verified in one spot. JavaScript's
 * single-threaded, run-to-completion execution guarantees that no other
 * synchronous statement (including another in-flight call's own
 * transition) can run between the read and the write of a single
 * expression, so this is race-free without locks — as long as nobody
 * hoists `breaker` into a local variable before an `await` and reuses
 * that stale snapshot afterwards. Do not do that.
 */
export function createResilientFetch(config?: ResilientFetchConfig): typeof fetch {
  const maxRetries = config?.maxRetries ?? DEFAULTS.maxRetries;
  const retryDelayMs = config?.retryDelayMs ?? DEFAULTS.retryDelayMs;
  const threshold = config?.circuitBreakerThreshold ?? DEFAULTS.circuitBreakerThreshold;
  const resetMs = config?.circuitBreakerResetMs ?? DEFAULTS.circuitBreakerResetMs;
  const requestTimeoutMs = config?.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs;

  // Mutable reference — transition logic lives in pure nextBreakerState.
  // Mutate ONLY through applyTransition (see concurrency contract above).
  let breaker: CircuitBreaker = {
    state: "CLOSED",
    failures: 0,
    lastFailureTime: 0,
  };

  /** The sole mutation point for `breaker` — always reads the live value at call time. */
  function applyTransition(event: BreakerEvent, now: number): CircuitBreaker {
    breaker = nextBreakerState(breaker, event, threshold, resetMs, now);
    return breaker;
  }

  const resilientFetch: typeof fetch = async (input, init?) => {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const now = Date.now();
      const before = breaker;
      const after = applyTransition("attempt", now);
      const allowed = !(before.state === "OPEN" && after.state === "OPEN");
      if (!allowed) {
        throw new Error("Circuit breaker is OPEN — facilitator unavailable");
      }

      // Per-request timeout: abort if the facilitator hangs longer than
      // requestTimeoutMs. Compose with any caller-supplied AbortSignal.
      const timeoutCtrl = new AbortController();
      const timeoutId = setTimeout(() => timeoutCtrl.abort(), requestTimeoutMs);
      const callerSignal = init?.signal;
      if (callerSignal) {
        if (callerSignal.aborted) timeoutCtrl.abort(callerSignal.reason);
        else callerSignal.addEventListener("abort", () => timeoutCtrl.abort(callerSignal.reason), { once: true });
      }

      try {
        const response = await fetch(input, { ...init, signal: timeoutCtrl.signal });
        clearTimeout(timeoutId);

        if (isRetryableStatus(response.status)) {
          applyTransition("failure", Date.now());
          if (attempt < maxRetries) {
            await sleep(retryDelayMs * 2 ** attempt);
            continue;
          }
          // Last attempt — return the 5xx response as-is
          return response;
        }

        // Success or 4xx (non-retryable) — record success and return
        applyTransition("success", Date.now());
        return response;
      } catch (error: unknown) {
        clearTimeout(timeoutId);
        applyTransition("failure", Date.now());
        // AbortError from our timeout is retryable; AbortError from the caller
        // is not (caller wants to give up).
        const isTimeout =
          error instanceof DOMException && error.name === "AbortError" && !callerSignal?.aborted;
        if ((!isRetryable(error) && !isTimeout) || attempt >= maxRetries) {
          throw error;
        }
        await sleep(retryDelayMs * 2 ** attempt);
      }
    }

    // Should never reach here, but TypeScript needs it
    throw new Error("Retry loop exhausted");
  };

  return resilientFetch as typeof fetch;
}
