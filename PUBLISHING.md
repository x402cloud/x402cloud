# Publishing @x402cloud/* to npm

This repo publishes 9 packages under the `@x402cloud` scope. Nothing is on npm
yet — this guide is the runbook to change that. Packages stay at `0.1.x` until
the protocol is mainnet-proven; do **not** jump to `1.0`.

## Packages

| Package                  | Runtime deps (external)        | Workspace deps                          |
| ------------------------ | ------------------------------ | --------------------------------------- |
| `@x402cloud/protocol`    | none                           | none                                    |
| `@x402cloud/evm`         | `viem`                         | protocol                                |
| `@x402cloud/client`      | `viem`                         | protocol, evm                           |
| `@x402cloud/middleware`  | `hono` (peer)                  | protocol, evm                           |
| `@x402cloud/facilitator` | `hono`, `viem`                 | protocol, evm                           |
| `@x402cloud/agent`       | `viem` (peer)                  | protocol, client, evm                   |
| `@x402cloud/discovery`   | `hono` (optional peer)         | none                                    |
| `@x402cloud/manifests`   | none                           | protocol, middleware                    |
| `@x402cloud/probes`      | none                           | none                                    |

### Dependency rationale (peer vs. dependency)

We follow Hickey's "require less, provide more": each package declares only what
it actually needs at the boundary it operates on.

- **`viem` as a direct `dependency`** in `evm`, `client`, `facilitator`: these
  call viem at runtime (e.g. `viem/chains`, `privateKeyToAccount`) and surface
  viem types in their public API. They must guarantee a compatible viem is
  present, so it is bundled as a hard dep.
- **`viem` as a `peerDependency`** in `agent`: the agent SDK never imports viem
  directly. The consumer brings their own wallet/account (their viem instance),
  so we declare it as a peer to avoid a duplicate viem in the consumer's tree.
- **`hono` as a `peerDependency`** in `middleware`: middleware augments the
  consumer's existing Hono app — there must be exactly one Hono instance, so it
  is a peer (with `hono` in devDependencies for local builds/tests).
- **`hono` as an optional `peerDependency`** in `discovery`: only the
  `@x402cloud/discovery/hono` subpath needs Hono, and it uses `import type` only.
  Consumers using the pure builders never need Hono, hence `optional: true`.
- **`hono` as a direct `dependency`** in `facilitator`: the facilitator core
  constructs and owns its *own* Hono router (`new Hono()` in `routes.ts`) rather
  than augmenting a consumer app, so it bundles Hono as a hard dep.

### Workspace ranges

All intra-repo deps use `workspace:^`. On `pnpm publish` these are rewritten to a
caret range against the version being published (e.g. `^0.1.0`). Never publish a
package while a literal `workspace:*`/`workspace:^` string is still in its
manifest — that means it was not published through pnpm.

## Topological publish order

A package must be on npm before anything that depends on it. Publish in tiers
(packages within a tier are independent and can go in any order):

```
Tier 0:  protocol      probes      discovery
            │
Tier 1:  evm
            │
Tier 2:  client     middleware     facilitator
            │            │
Tier 3:  agent       manifests
```

Concretely, a safe linear order is:

```
1. @x402cloud/protocol
2. @x402cloud/evm
3. @x402cloud/client
4. @x402cloud/middleware
5. @x402cloud/facilitator
6. @x402cloud/agent
7. @x402cloud/manifests
8. @x402cloud/discovery
9. @x402cloud/probes
```

`pnpm -r publish` computes this order automatically from the dependency graph,
so you normally do not publish one-by-one — but if you ever publish individual
packages, follow the order above.

## Prerequisites

1. **npm org `@x402cloud` exists** and your npm user is a member with publish
   rights. Create it once at <https://www.npmjs.com/org/create> (free for public
   packages).
2. **Logged in:** `npm whoami` returns your user; otherwise `npm login`.
3. **2FA / automation token.** If your account enforces 2FA for publish, either
   publish interactively (pnpm will prompt for the OTP) or use a granular
   **automation** access token (`NPM_TOKEN`) in CI that bypasses the OTP prompt.
4. **Clean build.** `dist/` must be fresh:
   ```bash
   pnpm -r clean
   pnpm build      # turbo builds in topological order
   ```
   `publishConfig.access = "public"` is set on every package (scoped packages
   default to **restricted** — without this the first publish fails).

## Dry run (no upload)

Always dry-run first. This requires `dist/` to already exist (run `pnpm build`):

```bash
pnpm -r publish --dry-run --no-git-checks 2>&1 | tail -60
```

Inspect the output for each package and confirm:

- `workspace:^` ranges were rewritten to real `^0.1.0` ranges.
- The tarball file list contains **only** `dist/`, `package.json`, `README.md`,
  `LICENSE` — no `src/`, no `*.test.*`, no `node_modules`.
  (`@x402cloud/middleware` ships `src/resilience.test.ts` inside `src/`, so its
  build leaks `dist/resilience.test.*`. Its `files` field uses a negation glob
  `["dist", "!dist/**/*.test.*"]` to strip those from the tarball — verify those
  files are absent. A `.npmignore` does **not** work here: when a `files`
  allowlist is present, npm gives `files` precedence and ignores `.npmignore`.)
- `access: public` is reported.

To inspect a single package's tarball without the registry:

```bash
pnpm -F @x402cloud/middleware pack          # writes a .tgz
tar -tzf x402cloud-middleware-0.1.0.tgz     # list contents
```

## Publish (real)

After a clean dry run:

```bash
# Interactive (prompts for 2FA OTP when required)
pnpm -r publish --no-git-checks

# Or, in CI with an automation token:
NPM_TOKEN=*** pnpm -r publish --no-git-checks
```

`pnpm -r publish` skips packages whose current version already exists on the
registry, so re-running after a partial failure resumes safely.

> `--no-git-checks` is used because publishing is decoupled from the git state in
> this monorepo (versions are managed manually, not via `npm version`). Ensure
> the working tree is the intended commit before publishing.

## Releasing a new version

1. Bump the `version` in the changed package(s) and any dependents whose pinned
   range should move (stay within `0.1.x` for now).
2. `pnpm -r clean && pnpm build`
3. `pnpm -r publish --dry-run --no-git-checks` — verify.
4. `pnpm -r publish --no-git-checks`
5. Tag the release in git (`git tag v0.1.x && git push --tags`) once the user
   approves committing/pushing.

## Pre-publish checklist

- [ ] `npm whoami` shows a member of the `@x402cloud` org.
- [ ] `pnpm -r clean && pnpm build` succeeds with no type errors.
- [ ] `pnpm test` (unit) passes for every package.
- [ ] Every package has `publishConfig.access = "public"`.
- [ ] Every intra-repo dep is `workspace:^` (rewritten on publish).
- [ ] `version` is the intended `0.1.x` (not accidentally `1.0`).
- [ ] Dry run tarballs contain only `dist` + metadata (no `src`/tests/secrets).
- [ ] No `.env`, keys, or secrets anywhere in any tarball.
- [ ] README + LICENSE present at repo root (npm shows the root README per pkg
      only if a per-package README exists; consider adding per-package READMEs
      for better npm pages — optional, tracked separately).
```
