import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAlertCheck } from "../src/index.js";

const WEBHOOK_URL = "https://ntfy.example/x402cloud";

const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", mockFetch);

describe("runAlertCheck", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("is a no-op when ALERT_WEBHOOK_URL is not configured", async () => {
    await runAlertCheck({});
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("posts a plain-text alert to the webhook when probes are failing", async () => {
    mockFetch.mockImplementation(async (input: unknown) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url === WEBHOOK_URL) {
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      }
      // Every probe's own outbound call (RPC, facilitator, infer) fails —
      // this drives a guaranteed "probe(s) failing" condition per target.
      throw new Error("network unreachable in test");
    });

    await runAlertCheck({ ALERT_WEBHOOK_URL: WEBHOOK_URL });

    const webhookCall = mockFetch.mock.calls.find(([input]) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      return url === WEBHOOK_URL;
    });
    expect(webhookCall).toBeDefined();

    const [, init] = webhookCall!;
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)?.Title).toBe("x402cloud status alert");
    const body = String(init?.body);
    expect(body).toContain("x402cloud status alert");
    expect(body).toContain("probe(s) failing");
  });

  it("does not post when the settlement KV is bound but has no records at all", async () => {
    mockFetch.mockImplementation(async (input: unknown) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url === WEBHOOK_URL) return { ok: true, status: 200, json: async () => ({}) } as Response;
      throw new Error("network unreachable in test");
    });

    const emptyKv = {
      async list() {
        return { keys: [], list_complete: true };
      },
      async get() {
        return null;
      },
    };

    await runAlertCheck({ ALERT_WEBHOOK_URL: WEBHOOK_URL, SETTLEMENTS: emptyKv });

    // Probes still fail (network unreachable), so the webhook still fires —
    // but the message must not claim a settlement-failure spike with zero data.
    const webhookCall = mockFetch.mock.calls.find(([input]) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      return url === WEBHOOK_URL;
    });
    expect(webhookCall).toBeDefined();
    const [, init] = webhookCall!;
    expect(String(init?.body)).not.toContain("settlement failures");
  });
});
