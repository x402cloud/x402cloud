/**
 * Witness of the canonical x402UptoPermit2Proxy: binds recipient AND the one
 * facilitator allowed to settle (the contract requires
 * `msg.sender == witness.facilitator`).
 */
export type UptoWitness = {
  readonly to: `0x${string}`;
  readonly facilitator: `0x${string}`;
  readonly validAfter: string;
};

/** Witness of the canonical x402ExactPermit2Proxy: binds recipient only. */
export type ExactWitness = {
  readonly to: `0x${string}`;
  readonly validAfter: string;
};

/** Union of the supported witness shapes. */
export type Permit2Witness = UptoWitness | ExactWitness;

/** Permit2 authorization signed by payer (witness shape varies by scheme) */
export type Permit2Authorization<W extends Permit2Witness = Permit2Witness> = {
  readonly from: `0x${string}`;
  readonly permitted: {
    readonly token: `0x${string}`;
    readonly amount: string;
  };
  readonly spender: `0x${string}`;
  readonly nonce: string;
  readonly deadline: string;
  readonly witness: Readonly<W>;
};

/** Signed payment payload for upto scheme (immutable — no settlement state) */
export type UptoPayload = {
  readonly signature: `0x${string}`;
  readonly permit2Authorization: Permit2Authorization<UptoWitness>;
};

/** Signed payment payload for exact scheme */
export type ExactPayload = {
  readonly signature: `0x${string}`;
  readonly permit2Authorization: Permit2Authorization<ExactWitness>;
};

/** Client-side signer interface */
export type ClientSigner = {
  address: `0x${string}`;
  signTypedData: (params: {
    domain: Record<string, unknown>;
    types: Record<string, readonly { name: string; type: string }[]>;
    primaryType: string;
    message: Record<string, unknown>;
  }) => Promise<`0x${string}`>;
};

/** Read-only signer — enough for verification (no private key needed) */
export type VerifySigner = {
  readContract: (params: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }) => Promise<unknown>;
  verifyTypedData: (params: {
    address: `0x${string}`;
    domain: Record<string, unknown>;
    types: Record<string, readonly { name: string; type: string }[]>;
    primaryType: string;
    message: Record<string, unknown>;
    signature: `0x${string}`;
  }) => Promise<boolean>;
};

/**
 * Full signer — verification + settlement (needs private key for writes).
 *
 * Settlement uses a TWO-STEP port — sign then send — so a send-time throw still
 * hands back a confirmable tx hash (Finding 1). `eth_sendRawTransaction` can
 * land the signed tx in the mempool and THEN lose the HTTP response: the throw
 * is NOT proof that no tx exists. Splitting SIGNING (deterministic hash, no
 * network) from SENDING lets settle classify a lost-response send as
 * pending-receipt (confirm the known hash) rather than failed (re-broadcast,
 * which double-spends the single-use nonce and reverts = lost revenue).
 *
 * - signSettlementTx: pure local signing — yields the deterministic tx hash and
 *   the serialized raw tx. No network call, so a throw here truly means no tx.
 * - sendRawSettlementTx: broadcasts the already-signed raw tx. A throw here may
 *   leave a live tx; callers must CONFIRM the hash, never re-sign/re-broadcast.
 *
 * `writeContract` is retained for callers that build a signer without the
 * two-step port (e.g. local-middleware composition); settle falls back to it
 * only when signSettlementTx is absent. New code (the hosted facilitator) should
 * provide the two-step port so the Finding 1 protection applies.
 */
export type FacilitatorSigner = VerifySigner & {
  /**
   * Sign (but do NOT send) a settlement tx. Returns the deterministic tx hash
   * and the serialized raw tx. Pure local crypto — no network, so a throw here
   * means no tx was ever created (safe to retry as a fresh broadcast).
   */
  signSettlementTx?: (params: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }) => Promise<{ hash: `0x${string}`; serialized: `0x${string}` }>;
  /**
   * Broadcast an already-signed raw tx. A throw may leave a live tx in the
   * mempool — the caller holds the hash and must CONFIRM it, never re-broadcast.
   */
  sendRawSettlementTx?: (serialized: `0x${string}`) => Promise<void>;
  /**
   * Legacy one-shot sign+send. Used only as a fallback when signSettlementTx is
   * not provided. A throw here is ambiguous (the tx may or may not have been
   * broadcast), which is exactly the Finding 1 hazard the two-step port avoids.
   */
  writeContract?: (params: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }) => Promise<`0x${string}`>;
  waitForTransactionReceipt: (params: {
    hash: `0x${string}`;
    /**
     * Max time (ms) to wait for the receipt. Settle passes an explicit, bounded
     * timeout so the worst-case settle wall-clock stays below the in_flight
     * lease (Finding 2). Omitted → the implementation's own default.
     */
    timeout?: number;
  }) => Promise<{ status: "success" | "reverted"; transactionHash: `0x${string}` }>;
};
