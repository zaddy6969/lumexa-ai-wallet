import { erc20Abi, formatUnits, getAddress } from "viem";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useChainId, useDisconnect, usePublicClient } from "wagmi";
import { ARC_PORTFOLIO_TOKENS, MULTICHAIN_WALLET_CHAINS, arcTestnet } from "./arc-chain";

const RETRY_DELAYS_MS = [0, 500];
const AUTO_REFRESH_MS = 60_000;
const IS_DEVELOPMENT = process.env.NODE_ENV !== "production";

const EXTERNAL_USDC_BY_CHAIN = {
  11155111: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
};

function normalizeAddress(address) {
  if (!address) return "";
  try {
    return getAddress(address);
  } catch {
    return address;
  }
}

function sleep(delayMs) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
}

function debugWalletLog(event, detail) {
  if (IS_DEVELOPMENT) console.info("[wallet-balance]", event, detail);
}

async function withRetry(task, label) {
  let lastError;
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt]);
      return await task();
    } catch (error) {
      lastError = error;
      debugWalletLog("request-failed", {
        label,
        attempt,
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }
  throw lastError;
}

function formatBalanceForDisplay(value, symbol) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return `0.00 ${symbol}`;
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: numeric >= 1000 ? 0 : 2,
    maximumFractionDigits: symbol === "USDC" ? 4 : 6
  }).format(numeric)} ${symbol}`;
}

function chainForId(chainId) {
  return MULTICHAIN_WALLET_CHAINS.find((chain) => chain.id === Number(chainId)) || null;
}

function tokenConfigForChain(chain) {
  if (!chain) return [];
  if (chain.id === arcTestnet.id) return ARC_PORTFOLIO_TOKENS;

  const usdcAddress = EXTERNAL_USDC_BY_CHAIN[chain.id];
  return usdcAddress
    ? [
        {
          symbol: "USDC",
          name: "USD Coin",
          address: usdcAddress,
          decimals: 6,
          priceUsd: 1,
          accent: "U",
          description: `${chain.name} USDC`
        }
      ]
    : [];
}

function createIdleAssets(chain) {
  const tokens = tokenConfigForChain(chain).map((token) => ({
    ...token,
    balance: "",
    balanceValue: 0,
    valueUsd: 0,
    status: token.address ? "idle" : "not-configured"
  }));

  if (chain && chain.id !== arcTestnet.id) {
    tokens.push({
      symbol: chain.nativeCurrency.symbol,
      name: chain.nativeCurrency.name,
      address: "native",
      decimals: chain.nativeCurrency.decimals,
      priceUsd: 0,
      accent: chain.nativeCurrency.symbol.slice(0, 1),
      description: `${chain.name} gas asset`,
      balance: "",
      balanceValue: 0,
      valueUsd: 0,
      status: "idle",
      native: true
    });
  }

  return tokens;
}

export function useArcWalletSnapshot() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { disconnect } = useDisconnect();
  const activeChain = useMemo(() => chainForId(chainId), [chainId]);
  const queryChainId = activeChain?.id || arcTestnet.id;
  const publicClient = usePublicClient({ chainId: queryChainId });
  const [usdcBalance, setUsdcBalance] = useState("");
  const [nativeBalance, setNativeBalance] = useState("");
  const [balanceStatus, setBalanceStatus] = useState("idle");
  const [balanceError, setBalanceError] = useState("");
  const [balanceSource, setBalanceSource] = useState("");
  const [assets, setAssets] = useState(() => createIdleAssets(activeChain));
  const displayAddress = useMemo(() => normalizeAddress(address || ""), [address]);

  useEffect(() => {
    let cancelled = false;
    let requestActive = false;
    const currentChain = activeChain;

    if (!displayAddress || !publicClient || !currentChain) {
      queueMicrotask(() => {
        if (cancelled) return;
        setUsdcBalance("");
        setNativeBalance("");
        setBalanceStatus("idle");
        setBalanceError("");
        setBalanceSource("");
        setAssets(createIdleAssets(currentChain));
      });
      return () => {
        cancelled = true;
      };
    }

    queueMicrotask(() => {
      if (!cancelled) setAssets(createIdleAssets(currentChain));
    });
    const loadBalances = async () => {
      if (
        requestActive ||
        (typeof document !== "undefined" && document.visibilityState === "hidden")
      )
        return;
      requestActive = true;
      try {
        setBalanceStatus((current) => (current === "ready" ? "refreshing" : "loading"));
        setBalanceError("");

        const configuredTokens = tokenConfigForChain(currentChain).filter((token) => token.address);
        const [nativeResult, tokenResults] = await Promise.allSettled([
          withRetry(() => publicClient.getBalance({ address: displayAddress }), "native-balance"),
          Promise.allSettled(
            configuredTokens.map((token) =>
              withRetry(
                () =>
                  publicClient.readContract({
                    address: token.address,
                    abi: erc20Abi,
                    functionName: "balanceOf",
                    args: [displayAddress]
                  }),
                `${token.symbol.toLowerCase()}-balance`
              )
            )
          )
        ]);

        if (cancelled) return;

        const nextAssets = configuredTokens.map((token, index) => {
          const result = tokenResults.status === "fulfilled" ? tokenResults.value[index] : null;
          if (result?.status !== "fulfilled" || typeof result.value !== "bigint") {
            return { ...token, balance: "", balanceValue: 0, valueUsd: 0, status: "error" };
          }

          const formatted = formatUnits(result.value, token.decimals);
          const balanceValue = Number(formatted);
          return {
            ...token,
            balance: formatBalanceForDisplay(formatted, token.symbol),
            balanceValue: Number.isFinite(balanceValue) ? balanceValue : 0,
            valueUsd:
              Number.isFinite(balanceValue) && token.priceUsd ? balanceValue * token.priceUsd : 0,
            status: "ready"
          };
        });

        let nativeFormatted = "";
        if (nativeResult.status === "fulfilled" && typeof nativeResult.value === "bigint") {
          nativeFormatted = formatUnits(nativeResult.value, currentChain.nativeCurrency.decimals);
          setNativeBalance(
            formatBalanceForDisplay(nativeFormatted, currentChain.nativeCurrency.symbol)
          );

          if (currentChain.id !== arcTestnet.id) {
            const nativeValue = Number(nativeFormatted);
            nextAssets.push({
              symbol: currentChain.nativeCurrency.symbol,
              name: currentChain.nativeCurrency.name,
              address: "native",
              decimals: currentChain.nativeCurrency.decimals,
              priceUsd: 0,
              accent: currentChain.nativeCurrency.symbol.slice(0, 1),
              description: `${currentChain.name} gas asset`,
              balance: formatBalanceForDisplay(nativeFormatted, currentChain.nativeCurrency.symbol),
              balanceValue: Number.isFinite(nativeValue) ? nativeValue : 0,
              valueUsd: 0,
              status: "ready",
              native: true
            });
          }
        } else {
          setNativeBalance("");
        }

        setAssets(nextAssets);
        const usdcAsset = nextAssets.find((asset) => asset.symbol === "USDC");
        if (usdcAsset?.status === "ready") {
          setUsdcBalance(usdcAsset.balance);
          setBalanceStatus("ready");
          setBalanceSource("erc20");
          return;
        }

        if (currentChain.id === arcTestnet.id && nativeFormatted) {
          setUsdcBalance(formatBalanceForDisplay(nativeFormatted, "USDC"));
          setBalanceStatus("ready");
          setBalanceSource("native");
          return;
        }

        setUsdcBalance("");
        setBalanceStatus(nextAssets.length ? "ready" : "error");
        setBalanceSource("");
        setBalanceError(
          nextAssets.length ? "" : `Balance data is unavailable on ${currentChain.name}.`
        );
      } catch (error) {
        if (cancelled) return;
        debugWalletLog("fatal-error", {
          chainId: currentChain.id,
          message: error instanceof Error ? error.message : "Unknown error"
        });
        setBalanceStatus("error");
        setBalanceError(`Could not sync balances on ${currentChain.name}.`);
      } finally {
        requestActive = false;
      }
    };

    void loadBalances();
    const timer = window.setInterval(loadBalances, AUTO_REFRESH_MS);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void loadBalances();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [displayAddress, publicClient, activeChain]);

  return {
    address: displayAddress,
    rawAddress: address || "",
    isConnected,
    isSignedIn: isConnected && Boolean(displayAddress),
    chainId,
    activeChain,
    activeChainName: activeChain?.name || "Unsupported network",
    activeExplorerUrl: activeChain?.blockExplorers?.default?.url || "",
    nativeSymbol: activeChain?.nativeCurrency?.symbol || "",
    supportedNetwork: Boolean(activeChain),
    onArc: chainId === arcTestnet.id,
    usdcBalance,
    nativeBalance,
    balanceStatus,
    balanceError,
    balanceSource,
    assets,
    disconnectWallet: disconnect
  };
}
