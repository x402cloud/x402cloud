# Contributing to x402cloud

Thanks for your interest in contributing! This guide will help you get started.

## Prerequisites

- Node.js 20+
- pnpm 9+
- Git

## Setup

```bash
git clone https://github.com/x402cloud/x402cloud.git
cd x402cloud
pnpm install
pnpm build
```

## Project Structure

```
packages/
  protocol/     — Core types and header encoding (zero deps)
  evm/          — EVM payment schemes (Permit2)
  middleware/   — Hono server middleware
  client/       — Client SDK (auto-pays 402 responses)
  facilitator/  — Facilitator core logic
apps/           — Deployed services
tests/          — End-to-end tests
examples/       — Usage examples
site/           — Documentation site
```

## Development

```bash
pnpm build       # Build all packages
pnpm test        # Run all tests
pnpm typecheck   # TypeScript type checking
pnpm dev         # Start dev servers
```

## Running E2E Tests

E2E tests require [Foundry](https://book.getfoundry.sh/) (for Anvil) and environment variables. Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
# Edit .env with your values
pnpm test
```

## Pull Request Process

1. Fork the repo and create a branch from `main`
2. Make your changes and add tests if applicable
3. Run `pnpm build && pnpm typecheck && pnpm test` to verify
4. Open a PR with a clear description of what changed and why

## Code Style

- TypeScript throughout
- Use explicit types at module boundaries
- Keep functions small and focused
- No `console.log` in library code — callers decide logging
- Prefer named exports over default exports

## Questions?

Open an issue at https://github.com/x402cloud/x402cloud/issues.
