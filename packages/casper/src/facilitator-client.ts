import type {
  CasperFacilitatorConfig,
  CasperSupportedKind,
  FetchLike,
  FetchLikeResponse,
} from "./types.js";
import {
  DEFAULT_FACILITATOR_TIMEOUT_MS,
  DEFAULT_FACILITATOR_URL,
} from "./constants.js";
import { CASPER_ERRORS, sanitizeErrorMessage, type CasperErrorReason } from "./errors.js";

/** Outcome of one facilitator round-trip. Never throws past this boundary. */
export type FacilitatorCall<T> =
  | { ok: true; body: T }
  | { ok: false; reason: CasperErrorReason; detail: string };

/**
 * HTTP client for the hosted Casper x402 facilitator.
 *
 * Casper settlement is deploy-based and requires a funded Casper account, so
 * this package delegates the privileged half of the protocol to the facilitator
 * rather than shipping a signer: `POST /verify`, `POST /settle`, `GET /supported`.
 * No Casper secret key is ever read, stored, or required by this repository.
 */
export type CasperFacilitatorClient = {
  /** Base URL in use (no trailing slash). */
  readonly url: string;
  /** Per-request timeout in ms. */
  readonly timeoutMs: number;
  /** POST an x402 body to a facilitator path. */
  post<T>(path: string, body: unknown): Promise<FacilitatorCall<T>>;
  /** GET a facilitator path. */
  get<T>(path: string): Promise<FacilitatorCall<T>>;
  /** `GET /supported` — the scheme/network pairs the facilitator will service. */
  supported(): Promise<FacilitatorCall<{ kinds: CasperSupportedKind[] }>>;
};

function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid CASPER_FACILITATOR_URL: not a URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`CASPER_FACILITATOR_URL must use http(s)://, got ${url.protocol}`);
  }
  if (url.protocol === "http:") {
    const isLocalhost =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1" ||
      url.hostname.endsWith(".local");
    if (!isLocalhost) {
      throw new Error("CASPER_FACILITATOR_URL: http:// is only permitted for localhost; use https://");
    }
  }
  if (url.username || url.password) {
    throw new Error(
      "CASPER_FACILITATOR_URL must not contain inline credentials; pass keys via headers",
    );
  }
  return url.toString().replace(/\/+$/, "");
}

function parseTimeout(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.length === 0) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error("CASPER_FACILITATOR_TIMEOUT_MS must be a positive integer (milliseconds)");
  }
  const n = Number(raw);
  if (n <= 0 || !Number.isSafeInteger(n)) {
    throw new Error("CASPER_FACILITATOR_TIMEOUT_MS must be a positive integer (milliseconds)");
  }
  return n;
}

/**
 * Create a facilitator client.
 *
 * Resolution order for both settings is explicit config → environment →
 * package default, so an operator can pin a self-hosted facilitator without
 * touching code.
 */
export function createCasperFacilitatorClient(
  config: CasperFacilitatorConfig = {},
): CasperFacilitatorClient {
  const env = config.env ?? process.env;
  const url = normalizeBaseUrl(
    config.facilitatorUrl ?? env.CASPER_FACILITATOR_URL ?? DEFAULT_FACILITATOR_URL,
  );
  const timeoutMs =
    config.timeoutMs ??
    parseTimeout(env.CASPER_FACILITATOR_TIMEOUT_MS, DEFAULT_FACILITATOR_TIMEOUT_MS);

  const doFetch: FetchLike | undefined =
    config.fetch ?? (typeof globalThis.fetch === "function" ? (globalThis.fetch as unknown as FetchLike) : undefined);

  async function request<T>(
    path: string,
    init: { method: "GET" | "POST"; body?: unknown },
  ): Promise<FacilitatorCall<T>> {
    if (!doFetch) {
      return {
        ok: false,
        reason: CASPER_ERRORS.FACILITATOR_UNREACHABLE,
        detail: "no fetch implementation available",
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: FetchLikeResponse;
    try {
      res = await doFetch(`${url}${path}`, {
        method: init.method,
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal: controller.signal,
      });
    } catch (err) {
      // A timeout surfaces as an AbortError; everything else is transport.
      const aborted = controller.signal.aborted || (err as { name?: string })?.name === "AbortError";
      return {
        ok: false,
        reason: aborted ? CASPER_ERRORS.FACILITATOR_TIMEOUT : CASPER_ERRORS.FACILITATOR_UNREACHABLE,
        detail: sanitizeErrorMessage(err),
      };
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      let detail = `status ${res.status}`;
      try {
        const text = await res.text();
        if (text) detail = `${detail}: ${sanitizeErrorMessage(text)}`;
      } catch {
        // Body unavailable — the status alone is enough to fail closed.
      }
      return { ok: false, reason: CASPER_ERRORS.FACILITATOR_ERROR, detail };
    }

    try {
      const body = (await res.json()) as T;
      if (typeof body !== "object" || body === null) {
        return {
          ok: false,
          reason: CASPER_ERRORS.FACILITATOR_MALFORMED_RESPONSE,
          detail: "response body is not a JSON object",
        };
      }
      return { ok: true, body };
    } catch (err) {
      return {
        ok: false,
        reason: CASPER_ERRORS.FACILITATOR_MALFORMED_RESPONSE,
        detail: sanitizeErrorMessage(err),
      };
    }
  }

  return {
    url,
    timeoutMs,
    post: (path, body) => request(path, { method: "POST", body }),
    get: (path) => request(path, { method: "GET" }),
    supported: async () => {
      const res = await request<{ kinds?: unknown }>("/supported", { method: "GET" });
      if (!res.ok) return res;
      const kinds = res.body.kinds;
      if (!Array.isArray(kinds)) {
        return {
          ok: false,
          reason: CASPER_ERRORS.FACILITATOR_MALFORMED_RESPONSE,
          detail: "missing kinds array",
        };
      }
      return { ok: true, body: { kinds: kinds as CasperSupportedKind[] } };
    },
  };
}
