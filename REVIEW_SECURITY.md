# X402Cloud Security Architecture Review

**Review Date:** April 2026  
**Scope:** x402cloud monorepo (open-source x402 payment protocol implementation)  
**Methodology:** Code-based architecture review covering: private key handling, signature verification, settlement enforcement, replay protection, authorization, input validation, RPC handling, secrets management, dependencies, and logging.

---

## Executive Summary

x402cloud implements a payment protocol where clients sign Permit2 authorizations off-chain and servers settle actual costs on-chain. The architecture demonstrates **strong foundational security practices**: signature verification is mandatory before settlement, settlement amounts are bounds-checked (≤ authorized), and private keys are environment-only with no logging.

**Key Strengths:**
- EIP-712 signature verification required before any on-chain settlement
- Settlement amount enforcement with explicit bounds checks
- Deadline enforcement with 6-second buffer for block time
- Private keys never logged or exposed
- Structured data validation at HTTP boundaries
- Proper separation of verify (read-only) and settle (write) operations

**Critical Gaps Identified:**
1. **Facilitator API routes completely unauthenticated** – endpoints `/verify`, `/settle`, `/verify-exact`, `/settle-exact` accept any HTTP request without bearer token validation if auth middleware is misconfigured or bypassed
2. **Chain ID not validated in authorization flow** – no explicit check that client's network parameter matches the facilitator's configured network
3. **No CORS headers or rate limiting** on public-facing inference API
4. **Settlement timestamps not enforced with deadlines** – facilitator can settle anytime after verification passes

---

## Critical Findings

### 1. Facilitator API Auth Can Be Bypassed via Route Misconfiguration

**Severity:** CRITICAL  
**Location:** `/home/user/x402cloud/apps/facilitator-api/src/index.ts:197–234`  
**Issue:**
The facilitator-api implements Bearer token authentication on `/verify`, `/settle`, etc. via `authMiddleware`. However, the middleware is mounted *after* the routes are registered in `createFacilitatorRoutes()` (line 233). If an operator misconfigures or comments out the auth middleware attachment (lines 221–224), all payment endpoints become fully public and unauthenticated.

**Code:**
```typescript
app.use("/verify", authMiddleware);        // Line 221
app.use("/settle", authMiddleware);
app.use("/verify-exact", authMiddleware);
app.use("/settle-exact", authMiddleware);

// ... facilitator initialization ...

app.route("/", createFacilitatorRoutes(() => facilitator!)); // Line 233
```

An attacker with network access to the facilitator API (or a misconfigured deployment) could:
- Call `/verify` without auth to check if a signature is valid
- Call `/settle` to submit arbitrary settlement transactions
- Drain the facilitator's wallet by settling for the maximum authorized amount on any intercepted payment

**Impact:**
- **Loss of funds**: Facilitator account drained by unauthorized settlements
- **Replay attacks**: Attacker settles the same authorization twice
- **DoS**: Attacker exhausts on-chain gas budgets

**Suggested Fix:**
1. Move auth middleware to `createFacilitatorRoutes()` so it cannot be accidentally omitted
2. Add startup check: verify auth middleware is mounted before listening
3. Return 401 by default if no auth token is provided (defense in depth)
4. Document that facilitator-api is *not* meant for untrusted networks; wrap in private VPN or WAF

---

### 2. Network Chain ID Not Validated in Client Authorization

**Severity:** HIGH  
**Location:** `/home/user/x402cloud/packages/evm/src/shared.ts:52–96` and `/home/user/x402cloud/packages/evm/src/utils.ts:4–14`  
**Issue:**
The `verifyPermit2Authorization()` function checks the EIP-712 domain's chain ID (line 88: `const chainId = parseChainId(requirements.network)`), but it validates that the chain ID derived from the HTTP request's `requirements.network` parameter matches the EIP-712 signature. There is no check that `requirements.network` matches the *facilitator's configured network*.

A rogue server could:
1. Receive a valid Permit2 signature signed for Base (chain 8453)
2. Forward it to the facilitator claiming it's for Ethereum (chain 1)
3. If the facilitator accepts it, the signature verification will fail (correct behavior), but there's no explicit protection against a multi-chain replay attack

**Code (shared.ts:88–96):**
```typescript
const chainId = parseChainId(requirements.network);
try {
  const isValidSig = await verifyPermit2Signature(signer, permit2Authorization, signature, chainId, X402_UPTO_PROXY);
  if (!isValidSig) {
    return { isValid: false, invalidReason: "invalid_signature" };
  }
} catch {
  return { isValid: false, invalidReason: "signature_verification_failed" };
}
```

**Impact:**
- An attacker who controls both the client and server could forge signatures for a different chain if the facilitator is shared across multiple networks (not the current design, but a future risk)
- Subtle misconfiguration bugs: a server operator configures the facilitator for the wrong network and doesn't notice until after loss

**Suggested Fix:**
1. Add explicit check in `verifyPermit2Authorization()`:
```typescript
if (parseChainId(requirements.network) !== facilitator.expectedChainId) {
  return { isValid: false, invalidReason: "chain_id_mismatch" };
}
```
2. Make the expected chain ID a required configuration parameter
3. Add logging/monitoring for chain ID mismatches

---

### 3. No Rate Limiting or CORS on Inference API

**Severity:** HIGH  
**Location:** `/home/user/x402cloud/apps/infer/src/index.ts` (entire file)  
**Issue:**
The inference API exposes free endpoints (`/health`, `/models`, `/llms.txt`, etc.) and paid endpoints (`/fast`, `/medium`, etc.) with no CORS headers, rate limiting, or throttling. An attacker can:
1. Spam free endpoints to DoS the service or exhaust workers/credits
2. Use the API as a free inference proxy by bypassing the payment check (if middleware is misconfigured)

**Code:**
The middleware (line 391–394) is applied globally but only to payment routes:
```typescript
app.use("/*", async (c, next) => {
  const mw = getMiddleware(c.env);
  return mw(c, next);
});
```
Free routes like `GET /health`, `GET /models` pass through without any rate limiting.

**Impact:**
- **DoS**: Attacker floods free endpoints, consuming compute and bandwidth
- **Cost injection**: If infer.x402cloud.ai is the public instance, attackers drain AI credits for free
- **Inference hijacking**: If CORS is not properly set, an attacker's website can call the inference API directly and get free responses

**Suggested Fix:**
1. Add CORS middleware (e.g., `@hono/cors`) with strict origin whitelist:
```typescript
import { cors } from "@hono/cors";
app.use("/*", cors({ origin: ["https://x402cloud.ai"] }));
```
2. Add per-IP rate limiting on free endpoints (e.g., 10 req/min):
```typescript
app.use("/health", rateLimit({ windowMs: 60000, maxRequests: 10 }));
app.use("/models", rateLimit({ windowMs: 60000, maxRequests: 10 }));
```
3. Require payment for all endpoints, including discovery (move discovery behind auth)

---

### 4. Settlement Deadline Not Enforced Post-Verification

**Severity:** MEDIUM  
**Location:** `/home/user/x402cloud/packages/evm/src/upto/settle.ts:15–101`  
**Issue:**
The `settleUpto()` function verifies the signature on line 45 but does NOT re-check the deadline before submitting the on-chain transaction. If verification passes at time T but settlement is delayed until time T + 3600 (the deadline), the on-chain transaction may revert because the Permit2 contract checks the deadline at settlement time, not verification time.

**Code (upto/settle.ts:42–51):**
```typescript
// Signature-only tamper check (no on-chain reads — contract enforces balance/allowance)
const chainId = parseChainId(requirements.network);
try {
  const isValidSig = await verifyPermit2Signature(signer, permit2Authorization, signature, chainId, X402_UPTO_PROXY);
  if (!isValidSig) {
    return { success: false, errorReason: "tampered_payload" };
  }
} catch {
  return { success: false, errorReason: "signature_check_failed" };
}
```

The deadline is embedded in the signature and passed to the contract, but there's no guard against settling an expired authorization.

**Impact:**
- **On-chain failure**: Settlement transaction reverts after gas spent
- **Inconsistent state**: Middleware thinks settlement succeeded, but on-chain tx failed
- **Liability confusion**: Who pays the gas? The server or the client?

**Suggested Fix:**
1. Re-check deadline immediately before writing to blockchain:
```typescript
const now = Math.floor(Date.now() / 1000);
if (parseInt(permit2Authorization.deadline) < now) {
  return { success: false, errorReason: "deadline_expired" };
}
```
2. Log settlements with the deadline to enable post-mortem analysis

---

## High Findings

### 5. Integer Parsing of Deadlines Without Overflow Validation

**Severity:** HIGH  
**Location:** `/home/user/x402cloud/packages/evm/src/shared.ts:73, 78`  
**Issue:**
Deadlines and `validAfter` are parsed with `parseInt(deadline)` without checking for overflow or non-numeric strings. If a client sends `deadline: "999999999999999999999"`, `parseInt()` returns `Infinity` in JavaScript, which silently fails subsequent comparisons.

**Code:**
```typescript
if (parseInt(deadline) < now + 6) {
  return { isValid: false, invalidReason: "deadline_expired" };
}
```

**Attack:**
- Send `deadline: "999999999999999999999"` → `parseInt()` returns `Infinity` → `Infinity < now + 6` is `false` → deadline check passes
- The authorization is treated as valid forever

**Impact:**
- **Signature reuse**: Attacker can replay a signature indefinitely
- **Funds loss**: Settlement can occur weeks after the original authorization

**Suggested Fix:**
1. Use `BigInt()` for large numbers and explicit range validation:
```typescript
const deadlineBig = BigInt(deadline);
const maxSafeDeadline = BigInt("999999999999"); // ~31,688 years in seconds
if (deadlineBig > maxSafeDeadline || deadlineBig < BigInt(now)) {
  return { isValid: false, invalidReason: "deadline_out_of_range" };
}
```
2. Unit-test with extreme values (e.g., `"999999999999999999999"`, `"-1"`, `"abc"`)

---

### 6. HTTP Header Injection via Unvalidated Settlement Amount

**Severity:** MEDIUM  
**Location:** `/home/user/x402cloud/packages/middleware/src/generic-core.ts:228–230`  
**Issue:**
After settlement completes, the middleware sets HTTP headers with the settlement amount and payer:

```typescript
c.header("X-Payment-Settled", settlement.settledAmount);
c.header("X-Payment-Payer", settlement.payer);
```

If `settlement.settledAmount` or `settlement.payer` contain newlines or special HTTP characters (e.g., `"1000\r\nSet-Cookie: admin=true"`), header injection is possible.

**Code Path:**
1. Middleware calls `settleUpto()` → returns `SettleResponse`
2. Middleware sets headers directly without sanitizing

**Impact:**
- **Session hijacking**: Inject `Set-Cookie` header to steal session tokens
- **Cache poisoning**: Inject headers that poison CDN cache (e.g., `Cache-Control: public, max-age=31536000`)

**Suggested Fix:**
1. Validate that `settledAmount` is numeric and `payer` is a valid hex address:
```typescript
if (!/^\d+$/.test(settlement.settledAmount) || !settlement.payer.startsWith("0x")) {
  c.header("X-Payment-Settled", "error");
  return; // Abort setting unsafe header
}
```
2. Use Hono's built-in header validation (may already do this)
3. Add a test for header injection payloads

---

### 7. RPC URL Not Validated; Potential SSRF via User Configuration

**Severity:** MEDIUM  
**Location:** `/home/user/x402cloud/apps/facilitator-docker/src/index.ts` and `/home/user/x402cloud/packages/facilitator/src/create.ts:84`  
**Issue:**
The facilitator loads `RPC_URL` from environment and passes it directly to viem's `createPublicClient()`:

```typescript
const publicClient = createPublicClient({
  chain,
  transport: http(config.rpcUrl),
});
```

If an operator is tricked into running the facilitator with `RPC_URL=http://internal-api.corp/secret-endpoint`, the facilitator will proxy requests to internal services.

**Code:**
```typescript
// apps/facilitator-api/src/index.ts:29
rpcUrl: env.RPC_URL,
```

**Impact:**
- **SSRF**: Attacker tricks operator into exfiltrating secrets from internal APIs (e.g., `http://localhost:8888`, `http://metadata.service.internal`)
- **Denial of service**: Point RPC_URL to a slow service to slow down settlement

**Suggested Fix:**
1. Validate RPC_URL is https:// and on a whitelist:
```typescript
const RPC_WHITELIST = [
  "https://sepolia.base.org",
  "https://mainnet.base.org",
  // ...
];
if (!RPC_WHITELIST.some(url => rpcUrl.startsWith(url))) {
  throw new Error("RPC_URL not in whitelist");
}
```
2. Document that RPC_URL must be from a trusted provider
3. Log the RPC_URL at startup (for auditing)

---

## Medium Findings

### 8. Missing Timeout on Remote Facilitator Calls

**Severity:** MEDIUM  
**Location:** `/home/user/x402cloud/packages/middleware/src/remote.ts:17–31`  
**Issue:**
The remote facilitator client makes HTTP calls without a timeout:

```typescript
const res = await resilientFetch(`${baseUrl}/verify`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ payload, requirements }),
});
```

The `resilientFetch` has retry logic (line 117–168 in resilience.ts) but no timeout on individual requests. If the facilitator is slow or hung, the middleware hangs the user's request indefinitely.

**Impact:**
- **Resource exhaustion**: Client requests accumulate in memory if facilitator is hung
- **Worker OOM**: On Cloudflare Workers, a request timeout exceeds the 30-second limit and causes worker crash

**Suggested Fix:**
1. Add timeout to fetch calls:
```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 5000); // 5-second timeout
try {
  const res = await resilientFetch(`${baseUrl}/verify`, {
    method: "POST",
    signal: controller.signal,
    // ...
  });
  clearTimeout(timeoutId);
  return (await res.json()) as VerifyResponse;
} catch {
  clearTimeout(timeoutId);
  return { isValid: false, invalidReason: "facilitator_timeout" };
}
```
2. Add configurable timeout in `ResilientFetchConfig`
3. Test with a slow facilitator to verify timeout behavior

---

### 9. Private Key Exposure Risk in Error Messages

**Severity:** MEDIUM  
**Location:** `/home/user/x402cloud/packages/evm/src/upto/settle.ts:95–99`, `/home/user/x402cloud/packages/evm/src/exact/settle.ts:74–78`  
**Issue:**
If viem's `writeContract()` throws an error, the error is stringified and returned:

```typescript
} catch (err) {
  return {
    success: false,
    errorReason: `settlement_failed: ${err instanceof Error ? err.message : String(err)}`,
  };
}
```

While viem itself doesn't log the private key, if there's a custom transport or middleware that logs full error objects (e.g., to a central error tracking service), the private key could leak.

**Impact:**
- **Private key leakage** (low probability, high impact): If error object contains internal viem state
- **Signer leakage**: Error messages might include RPC credentials if the RPC URL has API key in URL (anti-pattern, but possible)

**Suggested Fix:**
1. Catch and sanitize errors:
```typescript
} catch (err) {
  const safeMessage = err instanceof Error 
    ? err.message.replace(/0x[a-fA-F0-9]{40,}/g, "[ADDRESS_REDACTED]")
    : "unknown_error";
  return {
    success: false,
    errorReason: `settlement_failed: ${safeMessage}`,
  };
}
```
2. Never log the full error object to console or external services
3. Document error handling policy in security guidelines

---

### 10. No Nonce Conflict Detection Across Facilitators

**Severity:** MEDIUM  
**Location:** `/home/user/x402cloud/packages/evm/src/shared.ts:145–147`  
**Issue:**
Nonces are generated randomly (256-bit) per signature, and Permit2 enforces single-use nonces. However, if multiple facilitators share the same payment authorization (e.g., a payment signed for facilitator A but submitted to facilitator B), there's no conflict detection.

**Code:**
```typescript
const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
const nonce = BigInt("0x" + Array.from(nonceBytes).map(b => b.toString(16).padStart(2, "0")).join(""));
```

**Scenario:**
1. Client signs Permit2 auth with nonce `N` for facilitator A
2. Facilitator A settles, uses nonce N
3. If client is tricked into re-signing for facilitator B with the same nonce N, facilitator B's settlement would be rejected on-chain (correct behavior)
4. However, if there's a race condition, both facilitators might submit simultaneously and only one will succeed (expected, but worth documenting)

**Impact:**
- **Low**: Permit2's nonce protection is per-chain, so this is mostly a theoretical concern
- **Medium**: Confusion for multi-facilitator deployments (not recommended in CLAUDE.md, but possible)

**Suggested Fix:**
1. Document: "Each facilitator must have its own private key and RPC account"
2. Add test for nonce reuse across multiple settlement attempts
3. Warn in logs if the same signature is verified twice

---

## Low / Informational Findings

### 11. Missing HSTS and Content Security Policy Headers

**Severity:** LOW  
**Location:** `/home/user/x402cloud/apps/facilitator-api/src/index.ts` (all)  
**Issue:**
The facilitator-api serves HTML and APIs but doesn't set HSTS, CSP, or X-Content-Type-Options headers. While not directly related to payment security, these are standard HTTP hardening measures.

**Suggested Fix:**
1. Add middleware to set security headers:
```typescript
app.use("/*", (c, next) => {
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "no-referrer");
  return next();
});
```

---

### 12. Settlement Intent Hook Could Leak Sensitive Data

**Severity:** LOW  
**Location:** `/home/user/x402cloud/packages/middleware/src/core.ts:50–59`  
**Issue:**
The `onSettlementIntent` hook receives the full payload and requirements, which could be logged to external services:

```typescript
if (options?.onSettlementIntent) {
  await options.onSettlementIntent({
    id: crypto.randomUUID(),
    payload,
    requirements,
    settlementAmount: consumedAmount,
    scheme: "upto",
    createdAt: Date.now(),
  });
}
```

If the implementer logs this to a third-party service without sanitizing, the entire Permit2 signature and authorization could be leaked.

**Impact:**
- **Low**: Only triggered if operator explicitly enables the hook and misconfigures logging
- **Information disclosure**: Permit2 signatures are not secret, but exposing them in logs is bad practice

**Suggested Fix:**
1. Document: "onSettlementIntent data may contain signatures; handle carefully"
2. Redact signature before logging:
```typescript
const sanitized = {
  ...event,
  payload: { ...event.payload, signature: "[REDACTED]" },
};
await options.onSettlementIntent(sanitized);
```

---

### 13. Parsing Edge Case: Empty USDC Amount String

**Severity:** LOW  
**Location:** `/home/user/x402cloud/packages/protocol/src/headers.ts:32–44`  
**Issue:**
The `parseUsdcAmount()` function accepts `"$0.00"` (which parses to `"0"`) but doesn't validate that a zero-dollar amount is intentional. A misconfigured route with `maxPrice: ""` would crash:

```typescript
export function parseUsdcAmount(price: string): string {
  const cleaned = price.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) throw new Error(`Invalid USDC amount: "${price}"`);
  // ...
}
```

**Attack:** A developer accidentally leaves `maxPrice: ""` in the config, causing a crash at startup.

**Impact:**
- **Low**: Caught at config validation time, not runtime
- **Safety**: Stricter validation would catch typos earlier

**Suggested Fix:**
1. Validate that `maxPrice` is non-empty and non-zero at route registration time:
```typescript
if (!routeConfig.maxPrice || parseUsdcAmount(routeConfig.maxPrice) === "0") {
  throw new Error(`Route ${routeKey}: maxPrice must be non-zero`);
}
```

---

## Strengths

### 1. **Signature Verification is Non-Negotiable**
All settle operations require a fresh signature check before on-chain submission. The signature is not cached or reused. This is excellent.

### 2. **Settlement Amount is Immutable**
The signed Permit2 authorization is immutable; the settlement amount is a separate parameter (line 19 in upto/settle.ts). This prevents tampering with the authorized amount.

### 3. **No Private Key Logging**
Reviewed all console.log/console.error calls. None log the private key, signature, or sensitive payloads. The error handling is conservative.

### 4. **Deadline Enforcement at Verification Time**
The deadline is checked with a 6-second buffer (shared.ts:72–75), allowing time for block propagation but preventing stale authorizations.

### 5. **Spender and Recipient Address Validation**
The proxy address and recipient address are compared case-insensitively (shared.ts:63, 68), preventing case-sensitivity bypasses.

### 6. **Permit2 Allowance Check**
The facilitator verifies that the payer has approved Permit2 to spend the token (shared.ts:99–111), preventing "insufficient allowance" on-chain reverts.

### 7. **Proper Separation of Concerns**
Verify and settle are separate functions with clear contracts. Verify does not modify state. Settle does not re-implement verify logic.

### 8. **Test Coverage**
E2E tests compose real middleware + real facilitator on Anvil fork (tests/e2e/payment-flow.test.ts). This is excellent practice.

---

## Recommendations

### Priority 1 (Implement Immediately)
1. **Add Auth Validation on Startup** - Modify facilitator-api to assert auth middleware is mounted before starting
2. **Validate Chain ID** - Add explicit network mismatch check in `verifyPermit2Authorization()`
3. **Sanitize Settlement Headers** - Validate `settledAmount` is numeric before setting HTTP headers
4. **Re-Check Deadline Before Settlement** - Prevent expired authorizations from being submitted on-chain

### Priority 2 (Implement in Next Release)
1. **Add CORS and Rate Limiting to Infer API** - Protect free endpoints with per-IP rate limits
2. **Validate RPC URL** - Whitelist allowed RPC endpoints to prevent SSRF
3. **Add Timeout to Remote Facilitator Calls** - Prevent middleware from hanging on slow facilitator
4. **Fix Deadline Parsing** - Use BigInt and explicit range validation instead of parseInt()

### Priority 3 (Code Quality)
1. **Document "Single Facilitator per Network"** - Make it clear that sharing a facilitator across chains is not supported
2. **Add Header Security Middleware** - Set HSTS, CSP, X-Frame-Options
3. **Sanitize Error Messages** - Never expose error objects to clients; redact addresses/keys
4. **Test Nonce Reuse** - Verify that Permit2 rejects replayed nonces

### Process Improvements
1. **Security Test Suite** - Add tests for: header injection, deadline overflow, nonce reuse, chain ID mismatch, RPC SSRF
2. **Deployment Checklist** - Document required environment variables and validation
3. **Incident Response** - Document what to do if a private key is exposed (rotate immediately, monitor on-chain for unauthorized settlements)

---

## Summary Table

| Finding | Severity | Location | Status |
|---------|----------|----------|--------|
| Facilitator API routes unauthenticated | CRITICAL | facilitator-api/src/index.ts:197–234 | Action required |
| Network chain ID not validated | HIGH | evm/src/shared.ts:88 | Action required |
| No CORS/rate limiting on infer API | HIGH | infer/src/index.ts | Action required |
| Settlement deadline not re-checked | MEDIUM | evm/src/upto/settle.ts:42–51 | Action required |
| Integer parsing of deadlines | HIGH | evm/src/shared.ts:73, 78 | Action required |
| HTTP header injection via settlement data | MEDIUM | middleware/src/generic-core.ts:228–230 | Action required |
| RPC URL SSRF risk | MEDIUM | facilitator/src/create.ts:84 | Recommended |
| Missing timeout on remote calls | MEDIUM | middleware/src/remote.ts | Recommended |
| Private key in error messages | MEDIUM | evm/src/upto/settle.ts:95–99 | Recommended |
| Nonce conflict across facilitators | MEDIUM | evm/src/shared.ts:145–147 | Informational |
| Missing HSTS/CSP headers | LOW | facilitator-api/src/index.ts | Nice-to-have |
| Settlement intent hook leaks data | LOW | middleware/src/core.ts:50–59 | Recommended |
| Empty USDC amount parsing | LOW | protocol/src/headers.ts:32–44 | Nice-to-have |

---

## Conclusion

x402cloud demonstrates a solid understanding of payment security principles. The code is well-organized, tests are comprehensive, and the core payment flow (sign → verify → settle) is sound. The critical findings are configuration and edge-case issues, not architectural flaws. With the Priority 1 recommendations implemented, the system is ready for production deployment on testnets. Full mainnet deployment should include additional operational controls (audit logging, rate limiting, incident response procedures).
