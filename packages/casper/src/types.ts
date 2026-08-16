import type { Network } from "@x402cloud/protocol";

/**
 * Signed payment payload for the Casper `exact` scheme (x402 v2).
 *
 * The payer signs a CEP-18 transfer authorization for wCSPR off-chain; the
 * hosted facilitator validates the signature and submits the deploy. This
 * package only transports the payload — it never holds a Casper secret key.
 */
export type CasperExactPayload = {
  /** Hex-encoded Ed25519/Secp256k1 signature produced by the payer's key. */
  signature: string;
  /** The authorization the signature covers. */
  authorization: CasperAuthorization;
};

/** The wCSPR transfer authorization signed by the payer. */
export type CasperAuthorization = {
  /** Payer public key (hex, with the Casper algorithm prefix byte). */
  from: string;
  /** Recipient — public key or account hash, as issued in `requirements.payTo`. */
  to: string;
  /** Amount in motes (integer string, 9 decimals). */
  value: string;
  /** wCSPR CEP-18 contract hash the transfer targets. */
  asset: string;
  /** CAIP-2 network the deploy must land on. */
  network: Network;
  /** Single-use nonce — the facilitator rejects replays. */
  nonce: string;
  /** Unix seconds; the authorization is invalid at or after this time. */
  deadline: string;
  /** Unix seconds; the authorization is invalid before this time. */
  validAfter: string;
};

/**
 * Minimal HTTP port used to reach the facilitator. Defaults to global `fetch`;
 * tests inject a stub rather than opening sockets (mirrors how the EVM package
 * injects a signer instead of an RPC client).
 */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<FetchLikeResponse>;

/** The subset of the Fetch `Response` interface this package relies on. */
export type FetchLikeResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

/** Construction options for {@link createCasperFacilitatorClient}. */
export type CasperFacilitatorConfig = {
  /** Base URL of the hosted facilitator. Defaults to `CASPER_FACILITATOR_URL`. */
  facilitatorUrl?: string;
  /** Per-request timeout in ms. Defaults to `CASPER_FACILITATOR_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Injected fetch implementation. Defaults to the global `fetch`. */
  fetch?: FetchLike;
  /** Environment bag used to resolve defaults. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
};

/** One `scheme`/`network` pair advertised by `GET /supported`. */
export type CasperSupportedKind = {
  scheme: string;
  network: Network;
  /** wCSPR contract hash the facilitator settles against, when advertised. */
  asset?: string;
};
