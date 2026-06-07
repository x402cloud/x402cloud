import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    alias: {
      // `cloudflare:workers` is a Workers runtime built-in (provides the
      // DurableObject base class) with no Node implementation. Production code
      // imports the real module; under vitest (Node) we alias a minimal shim so
      // src/* loads. The DO's atomic semantics are covered by direct unit tests
      // and an in-memory transactional fake — a real DO integration test under
      // miniflare/wrangler is a separate follow-up.
      "cloudflare:workers": fileURLToPath(new URL("./test/cloudflare-workers-shim.ts", import.meta.url)),
    },
  },
});
