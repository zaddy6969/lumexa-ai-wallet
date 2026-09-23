# Arc Microgrants — Lumexa submission notes

## Project description

Lumexa AI Wallet is a self-custodial wallet interface built around Arc's USDC-native execution. It helps users send and request USDC, review Circle App Kit swaps, bridge USDC across Arc, Ethereum, and Base, and prepare wallet actions in plain language. Keys and signatures stay in the user's connected wallet.

The Arc-specific work includes handling the shared native/ERC-20 USDC balance without double counting, reserving USDC gas, showing onchain confirmation, and validating network, amount, recipient, and quote freshness before requesting a signature. Bridge progress distinguishes source execution from destination completion.

## Submission links

- Live application: https://lumexa-aiwallet.vercel.app
- Public repository: https://github.com/zaddy6969/lumexa-ai-wallet
- Live network verification: https://lumexa-aiwallet.vercel.app/network
- Public builder profile: https://github.com/zaddy6969

## Evidence to complete before submission

1. Connect a wallet with a small USDC balance on Arc Mainnet, chain 5042.
2. Confirm the mainnet balance and receive request use the correct network.
3. Send a small amount to another address you control, leaving USDC for gas.
4. Confirm the receipt succeeds in Arc Explorer and save that public transaction URL.
5. Record a short walkthrough showing the mainnet badge, balance, reviewed transfer, receipt, and an AI-prepared action. Optionally demonstrate a small swap or bridge after checking its fees.
6. Include the live app and repository in the form. Confirm the work has not already received Circle/Arc program funding and that you can complete the payout verification.

**Mainnet transaction evidence:** to be supplied by the builder after wallet-approved execution. Automated checks and read-only quotes are not a substitute for a confirmed transfer. Lumexa integrates existing Arc contracts; do not describe it as a newly deployed Lumexa custody contract.

## Program details from the published announcement

The program lists 20 microgrants of 500 USDC, accepts working projects on Arc Mainnet, requires a public repo and builder profile, and closes October 14, 2026 at 23:59 ET. Decisions are due by October 21. Program terms and selection are controlled by Arc; deployment does not guarantee eligibility or selection.

Source: https://community.arc.io/public/events/arc-microgrants-f8tijfjhyq
