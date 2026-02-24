# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in x402cloud, please report it responsibly.

**Email:** security@x402cloud.ai

**Do NOT** open a public GitHub issue for security vulnerabilities.

## What to Report

- Vulnerabilities in the npm packages (`@x402cloud/protocol`, `evm`, `client`, `middleware`, `facilitator`)
- Payment verification bypasses or settlement logic flaws
- Permit2 signature validation issues
- Header encoding/decoding vulnerabilities that could lead to payment manipulation

## Out of Scope

- The hosted services (infer.x402cloud.ai, facilitator.x402cloud.ai) — report these directly via email
- Denial of service attacks
- Social engineering

## Response Timeline

- **Acknowledgment:** Within 48 hours
- **Initial assessment:** Within 1 week
- **Fix and disclosure:** Coordinated with reporter, typically within 30 days

## Disclosure Policy

We follow coordinated disclosure. We ask that you give us reasonable time to address the issue before public disclosure.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Acknowledgments

We appreciate security researchers who help keep x402cloud and its users safe.
