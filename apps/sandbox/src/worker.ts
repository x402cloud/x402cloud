/**
 * Worker entry point. Re-exports the Sandbox Durable Object class as required
 * by the @cloudflare/sandbox SDK, and the default Hono app.
 *
 * This module is the only place that imports from `@cloudflare/sandbox` at
 * the top level — keeping it isolated lets unit tests import `./index.js`
 * without pulling in the SDK (which has broken module resolution outside of
 * a Worker bundler).
 */
export { Sandbox } from "@cloudflare/sandbox";
export { default } from "./index.js";
