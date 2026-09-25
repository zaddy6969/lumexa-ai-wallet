# Security policy

Lumexa is a self-custodial wallet interface for Arc Mainnet. It never requests a seed phrase or private key, and every transaction must be approved by the connected wallet.

## Reporting a vulnerability

Please use GitHub's private vulnerability-reporting flow for this repository. Do not include wallet secrets, seed phrases, private keys, or production credentials in a report. Avoid opening a public issue until the maintainer has had a reasonable opportunity to investigate.

## Supported version

Security fixes target the current `main` branch and the production deployment linked from the repository.

## Dependency controls

- Production installs are locked with `pnpm-lock.yaml` and supply-chain policy checks.
- Patched transitive versions are resolved explicitly in `pnpm-workspace.yaml`.
- CI blocks critical production advisories and runs linting, TypeScript, unit tests, and a production build.
- Breaking transitive overrides are rejected when runtime import checks show incompatibility.

The September 23, 2026 production dependency audit reports zero critical advisories and four inherited transitive advisories (two high, one moderate, one low). These remain tracked rather than forcing incompatible major versions:

- Two `image-size` parser denial-of-service advisories in Metro, installed beneath Porto by Wagmi. Lumexa does not run Metro or parse ICNS, JXL, or HEIF assets at runtime.
- One `stream-json` filter complexity advisory beneath Circle's Solana JSON-RPC dependency. Jayson uses the stream/value verifier path, not the vulnerable filter helpers; forcing version 3 breaks its CommonJS API.
- One low-severity `elliptic` implementation advisory beneath Circle's ethers v5 dependency. The patched version named by the advisory is not published.

These constraints should be rechecked whenever Circle App Kit, RainbowKit, Wagmi, or their connector packages release updates.

## AI transaction boundary

The model has no private keys and no signing or arbitrary-calldata tool. Its allowlisted tools return validated transaction parameters. Send, Swap and Bridge fetch live reviews in the browser. A user confirmation opens connected-wallet signing; it never bypasses that wallet's approval. The app rejects expired reviews, changed accounts/networks and reused chat confirmations. AI/provider errors return explicit errors with no fallback success or scripted answer. API access is rate-limited per IP per server instance; production-wide budget controls belong in the team's AI Gateway settings.
