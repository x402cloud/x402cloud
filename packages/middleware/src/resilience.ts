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

interface CircuitBreaker {
  state: CircuitState;
  failures: number;
  lastFailureTime: number;
}

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
  return true; // Unknown errors default to retryable
}

function isRetryableStatus(status: number): boolean {
  return status >= 500;
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

  const breaker: CircuitBreaker = {
    state: "CLOSED",
    failures: 0,
    lastFailureTime: 0,
  };

  function recordSuccess(): void {
    breaker.failures = 0;
    breaker.state = "CLOSED";
  }

  function recordFailure(): void {
    breaker.failures++;
    breaker.lastFailureTime = Date.now();
    if (breaker.failures >= threshold) {
      breaker.state = "OPEN";
    }
  }

  function canAttempt(): boolean {
    if (breaker.state === "CLOSED") return true;
    if (breaker.state === "OPEN") {
      if (Date.now() - breaker.lastFailureTime >= resetMs) {
        breaker.state = "HALF_OPEN";
        return true;
      }
      return false;
    }
    // HALF_OPEN — allow one probe
    return true;
  }

  const resilientFetch: typeof fetch = async (input, init?) => {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (!canAttempt()) {
        throw new Error("Circuit breaker is OPEN — facilitator unavailable");
      }

      try {
        const response = await fetch(input, init);

        if (isRetryableStatus(response.status)) {
          recordFailure();
          if (attempt < maxRetries) {
            await sleep(retryDelayMs * 2 ** attempt);
            continue;
          }
          // Last attempt — return the 5xx response as-is
          return response;
        }

        // Success or 4xx (non-retryable) — record success and return
        recordSuccess();
        return response;
      } catch (error: unknown) {
        recordFailure();
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
