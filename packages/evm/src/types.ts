/** Permit2 witness binding payment to specific recipient */
export type Permit2Witness = {
  to: `0x${string}`;
  validAfter: string;
  extra: `0x${string}`;
};

/** Permit2 authorization signed by payer */
export type Permit2Authorization = {
  from: `0x${string}`;
  permitted: {
    token: `0x${string}`;
    amount: string;
  };
  spender: `0x${string}`;
  nonce: string;
  deadline: string;
  witness: Permit2Witness;
};

/** Signed payment payload for upto scheme (immutable — no settlement state) */
export type UptoPayload = {
  signature: `0x${string}`;
  permit2Authorization: Permit2Authorization;
};

/** Signed payment payload for exact scheme */
export type ExactPayload = {
  signature: `0x${string}`;
  permit2Authorization: Permit2Authorization;
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

/** Full signer — verification + settlement (needs private key for writes) */
export type FacilitatorSigner = VerifySigner & {
  writeContract: (params: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }) => Promise<`0x${string}`>;
  waitForTransactionReceipt: (params: {
    hash: `0x${string}`;
  }) => Promise<{ status: "success" | "reverted"; transactionHash: `0x${string}` }>;
};
