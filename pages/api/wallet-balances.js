import { createPublicClient, erc20Abi, formatUnits, getAddress, http, isAddress } from "viem";
import { enforceRateLimit } from "../../lib/api-security";
import {
  ARC_PORTFOLIO_TOKENS,
  ARC_USDC_ERC20_ADDRESS,
  MULTICHAIN_WALLET_CHAINS,
  arcTestnet
} from "../../lib/arc-chain";
import { isZeroEvmAddress } from "../../lib/wallet-validation.mjs";

const PRICE_CACHE = Symbol.for("lumexa.marketPriceCache");
const PRICE_CACHE_MS = 60_000;
const USDC_BY_CHAIN = {
  [arcTestnet.id]: ARC_USDC_ERC20_ADDRESS,
  11155111: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
};

function safeNumber(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatAmount(value, maximumFractionDigits = 6) {
  const numeric = safeNumber(value);
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: numeric >= 1000 ? 0 : 2,
    maximumFractionDigits
  }).format(numeric);
}

function formatUsd(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(safeNumber(value));
}

async function readSpotPrice(pair) {
  try {
    const response = await fetch(`https://api.coinbase.com/v2/prices/${pair}/spot`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(2500)
    });
    if (!response.ok) return 0;
    const payload = await response.json();
    return safeNumber(payload?.data?.amount);
  } catch {
    return 0;
  }
}

async function readMarketPrices() {
  const needsPrices = MULTICHAIN_WALLET_CHAINS.some((chain) => !chain.testnet);
  if (!needsPrices) return { ethUsd: 0, btcUsd: 0, source: "disabled-on-testnet" };

  const cached = globalThis[PRICE_CACHE];
  if (cached && Date.now() - cached.checkedAt < PRICE_CACHE_MS) return cached.value;

  const [ethUsd, btcUsd, eurUsd] = await Promise.all([
    readSpotPrice("ETH-USD"),
    readSpotPrice("BTC-USD"),
    readSpotPrice("EUR-USD")
  ]);
  const value = {
    ethUsd,
    btcUsd,
    eurUsd,
    source: "coinbase-reference",
    checkedAt: new Date().toISOString()
  };
  globalThis[PRICE_CACHE] = { checkedAt: Date.now(), value };
  return value;
}

function tokenConfigForChain(chain, prices) {
  if (chain.id === arcTestnet.id) {
    return ARC_PORTFOLIO_TOKENS.filter((token) => token?.address).map((token) => ({
      ...token,
      referencePriceUsd: chain.testnet
        ? null
        : token.symbol === "cirBTC" && prices.btcUsd > 0
          ? prices.btcUsd
          : token.symbol === "EURC"
            ? prices.eurUsd || null
            : token.priceUsd || null
    }));
  }

  const usdcAddress = USDC_BY_CHAIN[chain.id] || "";
  return usdcAddress
    ? [
        {
          symbol: "USDC",
          name: "USD Coin",
          address: usdcAddress,
          decimals: 6,
          referencePriceUsd: chain.testnet ? null : 1
        }
      ]
    : [];
}

function unavailableNetwork(chain) {
  return {
    chainId: chain.id,
    name: chain.name,
    testnet: Boolean(chain.testnet),
    status: "unavailable",
    explorerUrl: chain?.blockExplorers?.default?.url || "",
    assets: [],
    assetCount: 0,
    assetSummary: "Balance read unavailable",
    totalReferenceUsd: null,
    totalReferenceUsdDisplay: "Unavailable",
    usdcBalance: 0,
    usdcDisplay: "0.00 USDC",
    nativeBalance: 0,
    nativeDisplay: `0.00 ${chain.nativeCurrency.symbol}`,
    nativeSymbol: chain.nativeCurrency.symbol
  };
}

async function readNetworkBalance(chain, address, prices) {
  const rpcUrl = chain?.rpcUrls?.default?.http?.[0];
  if (!rpcUrl) return unavailableNetwork(chain);

  const client = createPublicClient({
    chain,
    transport: http(rpcUrl, { timeout: 6000, retryCount: 0 })
  });
  const configuredTokens = tokenConfigForChain(chain, prices);
  const [nativeResult, tokenResults] = await Promise.all([
    client.getBalance({ address }).then(
      (value) => ({ status: "fulfilled", value }),
      () => ({ status: "rejected" })
    ),
    Promise.all(
      configuredTokens.map((token) =>
        client
          .readContract({
            address: token.address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [address]
          })
          .then(
            (value) => ({ status: "fulfilled", value }),
            () => ({ status: "rejected" })
          )
      )
    )
  ]);

  const nativeBalance =
    nativeResult.status === "fulfilled"
      ? safeNumber(formatUnits(nativeResult.value, chain.nativeCurrency.decimals))
      : 0;
  const assets = configuredTokens.map((token, index) => {
    const result = tokenResults[index];
    const balanceValue =
      result?.status === "fulfilled" ? safeNumber(formatUnits(result.value, token.decimals)) : 0;
    const referencePriceUsd = token.referencePriceUsd;
    const referenceValueUsd =
      result?.status === "fulfilled" && referencePriceUsd ? balanceValue * referencePriceUsd : null;
    return {
      symbol: token.symbol,
      name: token.name,
      balanceValue,
      balanceDisplay: `${formatAmount(balanceValue, ["USDC", "EURC"].includes(token.symbol) ? 4 : 8)} ${token.symbol}`,
      referencePriceUsd,
      referenceValueUsd,
      referenceValueUsdDisplay: chain.testnet
        ? "Testnet token"
        : referenceValueUsd === null
          ? "Price unavailable"
          : formatUsd(referenceValueUsd),
      status: result?.status === "fulfilled" ? "ready" : "unavailable",
      native: false
    };
  });

  const usdcAsset = assets.find((asset) => asset.symbol === "USDC");
  if (
    chain.id === arcTestnet.id &&
    usdcAsset?.status !== "ready" &&
    nativeResult.status === "fulfilled"
  ) {
    usdcAsset.balanceValue = nativeBalance;
    usdcAsset.balanceDisplay = `${formatAmount(nativeBalance, 4)} USDC`;
    usdcAsset.status = "ready";
    usdcAsset.referenceValueUsd = chain.testnet ? null : nativeBalance;
    usdcAsset.referenceValueUsdDisplay = chain.testnet ? "Testnet token" : formatUsd(nativeBalance);
  }

  if (chain.id !== arcTestnet.id && nativeResult.status === "fulfilled") {
    const referencePriceUsd =
      !chain.testnet && chain.nativeCurrency.symbol === "ETH" ? prices.ethUsd || null : null;
    const referenceValueUsd = referencePriceUsd ? nativeBalance * referencePriceUsd : null;
    assets.push({
      symbol: chain.nativeCurrency.symbol,
      name: chain.nativeCurrency.name,
      balanceValue: nativeBalance,
      balanceDisplay: `${formatAmount(nativeBalance, 6)} ${chain.nativeCurrency.symbol}`,
      referencePriceUsd,
      referenceValueUsd,
      referenceValueUsdDisplay: chain.testnet
        ? "Testnet gas"
        : referenceValueUsd === null
          ? "Price unavailable"
          : formatUsd(referenceValueUsd),
      status: "ready",
      native: true
    });
  }

  const hasSuccessfulRead =
    nativeResult.status === "fulfilled" || assets.some((asset) => asset.status === "ready");
  const positiveAssets = assets.filter(
    (asset) => asset.status === "ready" && asset.balanceValue > 0
  );
  const referenceValues = assets
    .map((asset) => asset.referenceValueUsd)
    .filter((value) => typeof value === "number");
  const totalReferenceUsd = referenceValues.length
    ? referenceValues.reduce((sum, value) => sum + value, 0)
    : null;

  return {
    chainId: chain.id,
    name: chain.name,
    testnet: Boolean(chain.testnet),
    status: hasSuccessfulRead ? "ready" : "unavailable",
    explorerUrl: chain?.blockExplorers?.default?.url || "",
    assets,
    assetCount: positiveAssets.length,
    assetSummary: positiveAssets.length
      ? positiveAssets.map((asset) => asset.balanceDisplay).join(" · ")
      : "No funded tracked assets",
    totalReferenceUsd,
    totalReferenceUsdDisplay: chain.testnet
      ? "Testnet assets"
      : totalReferenceUsd === null
        ? "Price unavailable"
        : formatUsd(totalReferenceUsd),
    usdcBalance: safeNumber(usdcAsset?.balanceValue),
    usdcDisplay: usdcAsset?.balanceDisplay || "0.00 USDC",
    nativeBalance,
    nativeDisplay: `${formatAmount(nativeBalance, 6)} ${chain.nativeCurrency.symbol}`,
    nativeSymbol: chain.nativeCurrency.symbol
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }
  if (!enforceRateLimit(req, res, { scope: "balances", limit: 45 })) return;

  const rawAddress = String(req.query?.address || "").trim();
  if (!isAddress(rawAddress) || isZeroEvmAddress(rawAddress)) {
    return res.status(400).json({ error: "A non-zero wallet address is required." });
  }

  const address = getAddress(rawAddress);
  const prices = await readMarketPrices();
  const settled = await Promise.allSettled(
    MULTICHAIN_WALLET_CHAINS.map((chain) => readNetworkBalance(chain, address, prices))
  );
  const networks = settled.map((result, index) =>
    result.status === "fulfilled"
      ? result.value
      : unavailableNetwork(MULTICHAIN_WALLET_CHAINS[index])
  );
  const readyNetworks = networks.filter((network) => network.status === "ready");
  const totalUsdc = readyNetworks.reduce(
    (sum, network) => sum + safeNumber(network.usdcBalance),
    0
  );
  const totalAssetCount = readyNetworks.reduce(
    (sum, network) => sum + safeNumber(network.assetCount),
    0
  );
  const allTestnet = networks.every((network) => network.testnet);
  const referenceValues = readyNetworks
    .map((network) => network.totalReferenceUsd)
    .filter((value) => typeof value === "number");
  const totalReferenceUsd =
    allTestnet || !referenceValues.length
      ? null
      : referenceValues.reduce((sum, value) => sum + value, 0);

  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
  return res.status(200).json({
    ok: true,
    address,
    environment: allTestnet ? "testnet" : "mainnet",
    testnetAssetsHaveNoMonetaryValue: allTestnet,
    totalUsdc,
    totalUsdcDisplay: `${formatAmount(totalUsdc, 4)} USDC`,
    totalReferenceUsd,
    totalReferenceUsdDisplay: allTestnet
      ? "Not valued on testnet"
      : totalReferenceUsd === null
        ? "Price unavailable"
        : formatUsd(totalReferenceUsd),
    totalAssetCount,
    networks,
    priceSource: prices.source,
    priceCheckedAt: prices.checkedAt || null,
    partial: readyNetworks.length !== networks.length,
    checkedAt: new Date().toISOString()
  });
}
