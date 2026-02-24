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
 * Check whether an attempt is allowed given the current breaker state.
 * Also returns the (possibly transitioned) breaker state.
 */
function checkAttempt(
  current: CircuitBreaker,
  threshold: number,
  resetMs: number,
  now: number,
): { allowed: boolean; breaker: CircuitBreaker } {
  const next = nextBreakerState(current, "attempt", threshold, resetMs, now);
  if (current.state === "OPEN" && next.state === "OPEN") {
    return { allowed: false, breaker: next };
  }
  return { allowed: true, breaker: next };
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
 */
export function createResilientFetch(config?: ResilientFetchConfig): typeof fetch {
  const maxRetries = config?.maxRetries ?? DEFAULTS.maxRetries;
  const retryDelayMs = config?.retryDelayMs ?? DEFAULTS.retryDelayMs;
  const threshold = config?.circuitBreakerThreshold ?? DEFAULTS.circuitBreakerThreshold;
  const resetMs = config?.circuitBreakerResetMs ?? DEFAULTS.circuitBreakerResetMs;

  // Mutable reference — transition logic lives in pure nextBreakerState
  let breaker: CircuitBreaker = {
    state: "CLOSED",
    failures: 0,
    lastFailureTime: 0,
  };

  const resilientFetch: typeof fetch = async (input, init?) => {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const check = checkAttempt(breaker, threshold, resetMs, Date.now());
      breaker = check.breaker;
      if (!check.allowed) {
        throw new Error("Circuit breaker is OPEN — facilitator unavailable");
      }

      try {
        const response = await fetch(input, init);

        if (isRetryableStatus(response.status)) {
          breaker = nextBreakerState(breaker, "failure", threshold, resetMs, Date.now());
          if (attempt < maxRetries) {
            await sleep(retryDelayMs * 2 ** attempt);
            continue;
          }
          // Last attempt — return the 5xx response as-is
          return response;
        }

        // Success or 4xx (non-retryable) — record success and return
        breaker = nextBreakerState(breaker, "success", threshold, resetMs, Date.now());
        return response;
      } catch (error: unknown) {
        breaker = nextBreakerState(breaker, "failure", threshold, resetMs, Date.now());
        if (!isRetryable(error) || attempt >= maxRetries) {
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
