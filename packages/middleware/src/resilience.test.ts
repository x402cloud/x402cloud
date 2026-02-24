import { describe, it, expect, vi, beforeEach } from "vitest";
import { createResilientFetch } from "./resilience.js";

// Mock global fetch
const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
});

function okResponse(body = {}) {
  return new Response(JSON.stringify(body), { status: 200 });
}

function serverErrorResponse(status = 500) {
  return new Response("error", { status });
}

function clientErrorResponse(status = 400) {
  return new Response("bad request", { status });
}

describe("createResilientFetch", () => {
  describe("retry logic", () => {
    it("returns immediately on success", async () => {
      const resilientFetch = createResilientFetch({ maxRetries: 2, retryDelayMs: 1 });
      mockFetch.mockResolvedValueOnce(okResponse());

      const res = await resilientFetch("https://example.com/verify", { method: "POST" });
      expect(res.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("retries on 5xx and succeeds on second attempt", async () => {
      const resilientFetch = createResilientFetch({ maxRetries: 2, retryDelayMs: 1 });
      mockFetch
        .mockResolvedValueOnce(serverErrorResponse(502))
        .mockResolvedValueOnce(okResponse());

      const res = await resilientFetch("https://example.com/verify", { method: "POST" });
      expect(res.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("does NOT retry on 4xx responses", async () => {
      const resilientFetch = createResilientFetch({ maxRetries: 2, retryDelayMs: 1 });
      mockFetch.mockResolvedValueOnce(clientErrorResponse(422));

      const res = await resilientFetch("https://example.com/verify", { method: "POST" });
      expect(res.status).toBe(422);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("retries on network errors and succeeds", async () => {
      const resilientFetch = createResilientFetch({ maxRetries: 2, retryDelayMs: 1 });
      mockFetch
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce(okResponse());

      const res = await resilientFetch("https://example.com/verify", { method: "POST" });
      expect(res.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("throws after exhausting all retries on network error", async () => {
      const resilientFetch = createResilientFetch({ maxRetries: 2, retryDelayMs: 1 });
      mockFetch.mockRejectedValue(new TypeError("fetch failed"));

      await expect(
        resilientFetch("https://example.com/verify", { method: "POST" }),
      ).rejects.toThrow("fetch failed");
      expect(mockFetch).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });

    it("returns last 5xx response after exhausting retries", async () => {
      const resilientFetch = createResilientFetch({ maxRetries: 1, retryDelayMs: 1 });
      mockFetch
        .mockResolvedValueOnce(serverErrorResponse(503))
        .mockResolvedValueOnce(serverErrorResponse(503));

      const res = await resilientFetch("https://example.com/verify", { method: "POST" });
      expect(res.status).toBe(503);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("circuit breaker", () => {
    it("opens after threshold consecutive failures", async () => {
      const resilientFetch = createResilientFetch({
        maxRetries: 0,
        retryDelayMs: 1,
        circuitBreakerThreshold: 3,
        circuitBreakerResetMs: 60_000,
      });

      // 3 consecutive failures to trip the breaker
      mockFetch.mockResolvedValue(serverErrorResponse(500));
      for (let i = 0; i < 3; i++) {
        await resilientFetch("https://example.com/verify", { method: "POST" });
      }

      // 4th call should fast-fail
      await expect(
        resilientFetch("https://example.com/verify", { method: "POST" }),
      ).rejects.toThrow("Circuit breaker is OPEN");
      // fetch should not have been called for the 4th attempt
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("resets to closed after a successful probe in half-open state", async () => {
      vi.useFakeTimers();
      try {
        const resilientFetch = createResilientFetch({
          maxRetries: 0,
          retryDelayMs: 1,
          circuitBreakerThreshold: 2,
          circuitBreakerResetMs: 1000,
        });

        // Trip the breaker
        mockFetch.mockResolvedValue(serverErrorResponse(500));
        for (let i = 0; i < 2; i++) {
          await resilientFetch("https://example.com/verify", { method: "POST" });
        }

        // Advance time past reset period
        vi.advanceTimersByTime(1100);

        // Next call should go through (half-open probe)
        mockFetch.mockResolvedValueOnce(okResponse());
        const res = await resilientFetch("https://example.com/verify", { method: "POST" });
        expect(res.status).toBe(200);

        // Circuit should now be closed — further calls work normally
        mockFetch.mockResolvedValueOnce(okResponse());
        const res2 = await resilientFetch("https://example.com/verify", { method: "POST" });
        expect(res2.status).toBe(200);
      } finally {
        vi.useRealTimers();
      }
    });

    it("re-opens if half-open probe fails", async () => {
      vi.useFakeTimers();
      try {
        const resilientFetch = createResilientFetch({
          maxRetries: 0,
          retryDelayMs: 1,
          circuitBreakerThreshold: 2,
          circuitBreakerResetMs: 1000,
        });

        // Trip the breaker
        mockFetch.mockResolvedValue(serverErrorResponse(500));
        for (let i = 0; i < 2; i++) {
          await resilientFetch("https://example.com/verify", { method: "POST" });
        }

        // Advance time past reset period
        vi.advanceTimersByTime(1100);

        // Half-open probe fails
        mockFetch.mockResolvedValueOnce(serverErrorResponse(500));
        await resilientFetch("https://example.com/verify", { method: "POST" });

        // Should be open again — note threshold is 2 and we had 3 failures total
        await expect(
          resilientFetch("https://example.com/verify", { method: "POST" }),
        ).rejects.toThrow("Circuit breaker is OPEN");
      } finally {
        vi.useRealTimers();
      }
    });

    it("resets failure count on success", async () => {
      const resilientFetch = createResilientFetch({
        maxRetries: 0,
        retryDelayMs: 1,
        circuitBreakerThreshold: 3,
        circuitBreakerResetMs: 60_000,
      });

      // 2 failures, then a success, then 2 more failures — should NOT trip
      mockFetch
        .mockResolvedValueOnce(serverErrorResponse(500))
        .mockResolvedValueOnce(serverErrorResponse(500))
        .mockResolvedValueOnce(okResponse())
        .mockResolvedValueOnce(serverErrorResponse(500))
        .mockResolvedValueOnce(serverErrorResponse(500));

      await resilientFetch("https://example.com/a", { method: "POST" });
      await resilientFetch("https://example.com/a", { method: "POST" });
      await resilientFetch("https://example.com/a", { method: "POST" }); // success resets
      await resilientFetch("https://example.com/a", { method: "POST" });
      await resilientFetch("https://example.com/a", { method: "POST" });

      // Should still work (only 2 consecutive failures after reset)
      mockFetch.mockResolvedValueOnce(okResponse());
      const res = await resilientFetch("https://example.com/a", { method: "POST" });
      expect(res.status).toBe(200);
    });
  });
});
