# Lumexa AI Wallet

A self-custodial wallet interface for **Arc Mainnet**: USDC payments, payment requests, Circle App Kit swaps and CCTP bridges, with model-backed AI assistance and explicit transaction reviews.

- **App:** https://lumexa-aiwallet.vercel.app
- **Live network check:** https://lumexa-aiwallet.vercel.app/network
- **Builder:** https://github.com/zaddy6969
- **Microgrants submission notes:** [docs/MICROGRANTS.md](docs/MICROGRANTS.md)

Lumexa uses Arc's existing token and protocol contracts. It does not deploy a custody contract, hold keys, or sign on behalf of users. A web deployment and a successful blockchain transaction are different evidence; verify a small signed mainnet transaction before submitting the project.

## Arc integration

| Setting               | Mainnet value                                            |
| --------------------- | -------------------------------------------------------- |
| Chain ID              | `5042` (`0x13b2`)                                        |
| RPC                   | `https://rpc.mainnet.arc.io`                             |
| Explorer              | `https://explorer.arc.io`                                |
| Gas asset             | USDC, native interface: 18 decimals                      |
| USDC ERC-20 interface | `0x3600000000000000000000000000000000000000`, 6 decimals |
| EURC                  | `0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1`, 6 decimals |
| cirBTC                | `0x171A4217b86A807A64eB94757Db6849fb4bDbAA0`, 8 decimals |
| Circle App Kit        | `1.15.2`, viem adapter `1.18.0`                          |
| App Kit chains        | `Arc`, `Ethereum`, `Base`                                |

Native and ERC-20 USDC are two interfaces to the **same balance**, not two assets. Send uses exact integer amounts, rejects zero recipients, and reserves a padded fee cap from that balance. The gas estimate respects Arc's minimum gas price of 20 gwei. It waits for a receipt rather than treating a transaction hash as confirmation.

Swap reviews expire after 60 seconds. Execution preserves the reviewed minimum output, rechecks the actual wallet account and chain, and requires wallet approval. Quotes depend on live route availability and liquidity.

Bridge uses Circle App Kit/CCTP with step-level status. Source approval or burn alone is not destination completion. Public transaction checkpoints are saved per wallet and environment in browser storage. A failed operation with a confirmed burn can resume destination delivery using App Kit's retry API. Keep the page open during bridging and save the transaction links; browser storage is not a durable recovery service.

Recent activity falls back to a bounded RPC scan of Arc's USDC system transfer events, including native transfers. It is not a complete historical indexer. Reference fiat values are indicative; unavailable prices are not invented.

## Product routes

- `/` — wallet overview and supported-network balances
- `/send`, `/receive` — USDC transfers and EIP-681 payment requests
- `/swap`, `/bridge` — live Circle App Kit quotes and wallet-approved execution
- `/activity` — recent public activity and locally submitted actions
- `/assistant` — real AI chat, wallet context, and in-chat transaction reviews
- `/network` — public live chain ID, latest block freshness, and USDC decimals check
- `/privacy`, `/terms` — product disclosures

Legacy portfolio and unified-balance URLs redirect to the wallet overview.

## Run locally

Requires Node.js 22+ and pnpm 11.19.0.

```bash
cp .env.example .env.local
pnpm install --frozen-lockfile
pnpm dev
```

Open http://localhost:3000. Mainnet is the default. For isolated testnet development, set `NEXT_PUBLIC_ARC_NETWORK=testnet`; it uses chain `5042002`, Ethereum Sepolia, and Base Sepolia. Testnet history and assistant sessions do not migrate into mainnet.

A Reown project ID is optional for WalletConnect; browser wallets and Safe do not require it. Keep all private keys, seed phrases, and server credentials out of `NEXT_PUBLIC_*` variables.

## Privacy and trust

- Every state-changing transaction requires review and a connected-wallet signature.
- The assistant cannot sign. Its actions are validated again by the transaction panels.
- AI chat uses Vercel AI SDK `ToolLoopAgent` through AI Gateway (default `openai/gpt-6-sol`). On Vercel, the SDK obtains runtime OIDC authentication; local development needs `AI_GATEWAY_API_KEY` or Vercel OIDC. The linked team must have AI Gateway access/credits.
- Users opt in before messages, recent conversation, balances and activity summaries reach the model. User-entered addresses are included so tools can prepare the correct recipient. No private keys are handled by the assistant. Provider errors are visible; chat never substitutes scripted responses.
- A model tool only prepares an action. The existing Send/Swap/Bridge panel loads a live review inside chat. An explicit “yes” or confirmation button opens wallet signing for that review. Reviews expire after 60 seconds, edits invalidate them, and repeated chat confirmations cannot replay the same review. Wallet signatures are always required.
- The assistant supports balances, activity, Send, Receive, Swap, Bridge, network switching and navigation. It does not execute arbitrary calldata or schedule autonomous transfers.
- Cloud requests redact full addresses and transaction hashes from model input. Never paste secrets into chat.
- App Kit uses its permissionless client path; no Circle secret key is shipped to the browser.
- Public APIs validate inputs, bound work, enforce same-origin writes, and use best-effort per-instance rate limits.
- This prototype is not independently audited. Dependency limitations are documented in [SECURITY.md](SECURITY.md).

## Verify and deploy

```bash
pnpm check
```

The check runs formatting, TypeScript, ESLint, the test suite in each of mainnet and testnet, the critical production dependency gate, and a production build. Tests cover precise amounts, gas reserves, stale reviews, account/network changes, AI action validation, privacy redaction, and bridge checkpoints. They do not sign real transactions.

The existing Vercel project builds from GitHub. Production explicitly selects mainnet in `next.config.mjs`, so a legacy testnet environment variable cannot silently publish a testnet wallet. Use a separate preview for testnet work. Network and token overrides remain public build-time configuration: only use verified official values.

After deployment, verify `/network`, wallet connection, balances, payment QR chain ID, and a small wallet-approved transfer. Confirm the receipt in Arc Explorer. Test swap and bridge with small amounts before relying on them for larger transfers. No live signing wallet is included in this repository.

## References

Verified against official documentation and installed SDK definitions on September 22–23, 2026:

- https://docs.arc.io/arc/references/connect-to-arc
- https://docs.arc.io/arc/references/contract-addresses
- https://docs.arc.io/arc/references/evm-differences
- https://developers.circle.com/app-kit
- https://community.arc.io/public/events/arc-microgrants-f8tijfjhyq
