/**
 * Margin helpers for the marketplace merchant-of-record model.
 *
 * Moved to `@x402cloud/protocol` (pure BigInt math, zero deps) so that
 * `@x402cloud/manifests` can use it without pulling in the middleware
 * package. Re-exported here so existing importers of `@x402cloud/middleware`
 * keep working unchanged.
 */
export { applyMargin, clampToAuthorized, retailPrice, DEFAULT_MARGIN_BPS } from "@x402cloud/protocol";
