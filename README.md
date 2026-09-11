# Lumexa AI Wallet

Lumexa is a focused, self-custodial USDC wallet for Arc. It combines explicit transaction review, cross-network testnet balances, recent public activity, and a local-first wallet copilot.

The current deployment is a testnet product. Test tokens are never presented as real dollar wealth.

## Product scope

- `/` — wallet overview, assets, and cross-network balances
- `/send` — review and send USDC on Arc
- `/receive` — share an address or exact EIP-681 payment request
- `/swap` — fetch a live Circle App Kit quote and approve in the wallet
- `/bridge` — bridge USDC across configured Arc, Ethereum, and Base networks
- `/activity` — bounded recent explorer history plus locally submitted actions
- `/assistant` — local-first explanations with explicit cloud-AI consent
- `/privacy` and `/terms` — product disclosures

Legacy portfolio and unified-balance URLs redirect to the wallet overview.

## Trust model

- Lumexa does not hold private keys or sign transactions.
- Every state-changing action is reviewed and approved in the connected wallet.
- The assistant processes wallet questions locally by default.
- Cloud AI is opt-in for the browser session. When enabled, Lumexa sends a minimized snapshot without the wallet address or full transaction hashes.
- AI provider keys remain server-side.
- Circle App Kit runs through its permissionless client path; no Circle API key is exposed or proxied through the browser.
- Public API routes validate input, apply bounded work, and use best-effort per-instance rate limits.

This is not a security audit, financial advice, or a guarantee about third-party contracts or bridges.

## Stack

- Next.js Pages Router and React
- RainbowKit, wagmi, viem, and ethers
- Circle App Kit
- TanStack Query
- Optional OpenAI or Vercel AI Gateway provider

## Local development

```bash
cp .env.example .env.local
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://localhost:3000`.

## Quality checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm audit:prod
pnpm format:check
pnpm build
```

`pnpm check` runs formatting, type checking, linting, unit tests, a production dependency gate, and a production build. The same checks run in GitHub Actions.

Security policy and current upstream dependency constraints are documented in `SECURITY.md`.

## Environment

Copy `.env.example` and configure at minimum:

```bash
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_walletconnect_project_id
NEXT_PUBLIC_SITE_URL=https://your-domain.example
```

Testnet Arc defaults are included. Cloud AI is optional:

```bash
OPENAI_API_KEY=
OPENAI_MODEL=
AI_GATEWAY_API_KEY=
AI_GATEWAY_MODEL=
```

Do not place private keys, seed phrases, or server API keys in any `NEXT_PUBLIC_` variable.

## Deployment

The repository is linked to Vercel. Push a branch for a preview deployment, run the end-to-end verification flow there, then promote the verified commit to production.

Arc Testnet defaults:

- Chain ID: `5042002`
- RPC: `https://rpc.testnet.arc.network`
- Explorer: `https://testnet.arcscan.app`
- Gas token: `USDC`
- Faucet: `https://faucet.circle.com`
