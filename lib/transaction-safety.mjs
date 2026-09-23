import { isEvmAddress, isZeroEvmAddress, parsePositiveDecimal } from "./wallet-validation.mjs";

export const ARC_MIN_GAS_PRICE = 20_000_000_000n;
export const REVIEW_LIFETIME_MS = 60_000;
export const USDC_SCALE = 1_000_000_000_000n;

export function assertRecipient(recipient) {
  if (!isEvmAddress(recipient) || isZeroEvmAddress(recipient)) {
    throw new Error("Enter a valid, non-zero recipient address.");
  }
}

export function parseTransferAmount(amount, decimals = 6) {
  const parsed = parsePositiveDecimal(amount, decimals);
  if (!parsed.valid) throw new Error(parsed.error);
  return parsed;
}

export function arcFeeEstimate(gas, gasPrice) {
  const gasLimit = (BigInt(gas) * 120n + 99n) / 100n;
  const price = BigInt(gasPrice || 0);
  const maxFeePerGas = (price > ARC_MIN_GAS_PRICE ? price : ARC_MIN_GAS_PRICE) * 2n;
  return { gasLimit, maxFeePerGas, fee: gasLimit * maxFeePerGas };
}

export function maxSendUnits(nativeBalance, fee) {
  const available = BigInt(nativeBalance) - BigInt(fee);
  return available > 0n ? available / USDC_SCALE : 0n;
}

export function assertReview(review, identity, now = Date.now()) {
  if (
    !review ||
    review.identity !== identity ||
    !Number.isFinite(review.createdAt) ||
    now < review.createdAt ||
    now - review.createdAt > REVIEW_LIFETIME_MS
  ) {
    throw new Error("This review has expired or changed. Review the transaction again.");
  }
}

export async function assertWalletIdentity(provider, address, chainId) {
  const [walletChain, accounts] = await Promise.all([
    provider.request({ method: "eth_chainId" }),
    provider.request({ method: "eth_accounts" })
  ]);
  if (Number(walletChain) !== Number(chainId))
    throw new Error("Wallet network changed. Review again.");
  if (String(accounts?.[0] || "").toLowerCase() !== String(address).toLowerCase()) {
    throw new Error("Wallet account changed. Review again with the connected account.");
  }
}

export function minimumSwapOutput(quote, decimals, slippageBps) {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 300)
    throw new Error("Invalid slippage limit.");
  const amount = parseTransferAmount(String(quote?.estimatedOutput?.amount || ""), decimals).units;
  const minimum = (amount * BigInt(10_000 - slippageBps)) / 10_000n;
  if (minimum <= 0n) throw new Error("The quoted output is too small to swap.");
  const scale = 10n ** BigInt(decimals);
  return `${minimum / scale}.${String(minimum % scale).padStart(decimals, "0")}`;
}

export function guardedWalletProvider(provider, address, allowedChainIds, onSubmitted = () => {}) {
  return {
    on: provider.on?.bind(provider),
    removeListener: provider.removeListener?.bind(provider),
    request: async (request) => {
      const signing =
        /^(eth_sendTransaction|eth_signTransaction|eth_signTypedData.*|personal_sign|wallet_sendCalls)$/.test(
          request.method
        );
      if (signing) {
        const chainId = Number(await provider.request({ method: "eth_chainId" }));
        if (!allowedChainIds.includes(chainId))
          throw new Error("Unexpected signing network. Review again.");
        await assertWalletIdentity(provider, address, chainId);
        const from = request.params?.[0]?.from;
        if (from && from.toLowerCase() !== address.toLowerCase())
          throw new Error("Unexpected signing account.");
      }
      const result = await provider.request(request);
      if (request.method === "eth_sendTransaction" && /^0x[\da-f]{64}$/i.test(result))
        onSubmitted(result);
      return result;
    }
  };
}

export function bridgeNeedsRecovery(result) {
  return result?.state !== "success" && Boolean(result?.steps?.some((step) => step.txHash));
}
