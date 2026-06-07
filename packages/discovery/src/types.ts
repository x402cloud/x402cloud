/**
 * Discovery types — a single representation of "a service" (meta + routes
 * + skills) that drives every output format (openapi, agent-card, llms.txt,
 * agents.json, sitemap.xml, robots.txt, api-catalog).
 *
 * These are pure data — no Response, no Hono, no Worker types. Each builder
 * takes this data in, returns plain JS data out.
 */

export type PaymentInfo = {
  /** Worst-case ceiling, e.g. "$0.001". Free-form string to allow currencies. */
  maxPrice: string;
  /** Human-readable network, e.g. "Base (USDC)" or "Base (EIP-155:8453)". */
  network: string;
  /** Optional recipient wallet — surfaced in `x-x402` and elsewhere. */
  payTo?: string;
};

/** Service-level metadata. Drives `info`, `agent-card`, agents.json header. */
export type ServiceMeta = {
  /** Hostname/identifier, e.g. "infer.x402cloud.ai" */
  name: string;
  /** Long-form description shown in OpenAPI `info.description` and elsewhere */
  description: string;
  /** Public base URL, e.g. "https://infer.x402cloud.ai" */
  baseUrl: string;
  /** Defaults to "1.0.0" if omitted */
  version?: string;
  /** Agent-card protocol identifier — defaults to "a2a" */
  protocol?: string;
  /** Short marketing description (one line) for agents.json/agent-card. Defaults to `description`. */
  shortDescription?: string;
  /** Optional facilitator URL — surfaced in OpenAPI `x-x402`. */
  facilitator?: string;
  /** Optional contact URL — surfaced in OpenAPI `info.contact`. */
  contactUrl?: string;
  /** Optional default input modes for agent-card. Defaults to ["application/json"]. */
  defaultInputModes?: string[];
  /** Optional default output modes for agent-card. Defaults to ["application/json"]. */
  defaultOutputModes?: string[];
};

/** A skill in the A2A agent-card sense — a coarse capability the service offers. */
export type ServiceSkill = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
};

/**
 * A single route on the service. Drives openapi.json paths, agents.json
 * endpoints, llms.txt entries, and sitemap.xml.
 *
 * Routes with a `payment` block are paid (get `x-x402` and 402 response in
 * OpenAPI). Routes without it are free.
 */
export type ServiceRoute = {
  /** e.g. "/fast" */
  path: string;
  method: "POST" | "GET";
  summary: string;
  /** OpenAPI operation id — defaults to method+path mangled */
  operationId?: string;
  /** OpenAPI tags */
  tags?: string[];
  /** Payment requirements — presence => paid route */
  payment?: PaymentInfo;
  /** JSON Schema for request body (paid POST routes) */
  requestSchema?: Record<string, unknown>;
  /** JSON Schema for the 200 response body */
  responseSchema?: Record<string, unknown>;
  /** Response content type — defaults to "application/json" */
  responseContentType?: string;
  /** Extra response statuses (e.g. 408 timeout, 502 upstream) keyed by code */
  extraResponses?: Record<string, { description: string }>;
  /** Agent-card skill examples for this route */
  examples?: string[];
  /** Optional agents.json `type` (e.g. "text", "embed", "sandbox", "scrape") */
  kind?: string;
};
