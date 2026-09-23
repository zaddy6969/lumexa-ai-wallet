import { useCallback, useMemo, useRef, useState } from "react";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { createArcAppKitClient, formatAppKitError } from "../lib/arc-app-kit";
import {
  ARC_APP_KIT_READY,
  ARC_BRIDGE_DESTINATION,
  ARC_CIRBTC_ERC20_ADDRESS,
  ARC_MAINNET_REQUESTED,
  ARC_PORTFOLIO_TOKENS,
  MULTICHAIN_WALLET_CHAINS,
  arcTestnet
} from "../lib/arc-chain";
import { createWalletActionRecord } from "../lib/local-activity";
import { switchWalletNetwork } from "../lib/wallet-network";
import {
  assertReview,
  assertWalletIdentity,
  minimumSwapOutput,
  parseTransferAmount,
  guardedWalletProvider
} from "../lib/transaction-safety.mjs";
import { FeatureIcon } from "./wallet-sidebar";

const TOKENS = ARC_PORTFOLIO_TOKENS.filter((token) => token.address).map((token) => token.symbol);
const DEFAULT_IN = TOKENS.includes("USDC") ? "USDC" : TOKENS[0] || "USDC";
const DEFAULT_OUT = TOKENS.find((token) => token !== DEFAULT_IN) || DEFAULT_IN;
const CONFIGURED =
  (!ARC_MAINNET_REQUESTED || ARC_APP_KIT_READY) &&
  Boolean(ARC_BRIDGE_DESTINATION.appKitChain) &&
  TOKENS.length >= 2;
const META = {
  USDC: { name: "USD Coin", mark: "$" },
  EURC: { name: "Euro Coin", mark: "€" },
  cirBTC: { name: "Circle Bitcoin", mark: "₿" }
};

function cleanAmount(value) {
  return String(value || "").trim();
}

function validAmount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function getAsset(walletSnapshot, symbol) {
  return (walletSnapshot?.assets || []).find((asset) => asset?.symbol === symbol) || null;
}

function tokenIdentifier(symbol) {
  return symbol === "cirBTC" ? ARC_CIRBTC_ERC20_ADDRESS : symbol;
}

function txHash(result) {
  if (result?.txHash) return result.txHash;
  return (result?.steps || []).find((step) => step?.txHash)?.txHash || "";
}

function explorerUrl(result, hash) {
  if (result?.explorerUrl) return result.explorerUrl;
  const fromStep = (result?.steps || []).find((step) => step?.explorerUrl)?.explorerUrl;
  if (fromStep) return fromStep;
  return hash && arcTestnet?.blockExplorers?.default?.url
    ? `${arcTestnet.blockExplorers.default.url}/tx/${hash}`
    : "";
}

function quoteRoot(estimate) {
  if (!estimate || typeof estimate !== "object") return estimate;
  if (estimate?.data?.estimatedOutput || estimate?.data?.amountOut || estimate?.data?.outputAmount)
    return estimate.data;
  if (estimate?.estimate?.estimatedOutput || estimate?.estimate?.amountOut)
    return estimate.estimate;
  return estimate;
}

function normalizeOutputAmount(value) {
  if (value === null || value === undefined || value === "") return "";
  const text = String(value).trim();
  const numeric = Number(text);
  if (!Number.isFinite(numeric)) return text;
  if (numeric === 0) return "0";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
    useGrouping: false
  }).format(numeric);
}

function outputQuote(estimate, tokenOut) {
  const root = quoteRoot(estimate);
  const direct = root?.estimatedOutput;
  if (direct && typeof direct === "object") {
    const amount = normalizeOutputAmount(direct.amount ?? direct.value ?? direct.formattedAmount);
    if (amount) return { amount, token: direct.token || direct.symbol || tokenOut };
  }
  if (typeof direct === "string" || typeof direct === "number") {
    const amount = normalizeOutputAmount(direct);
    if (amount) return { amount, token: tokenOut };
  }
  const fallback =
    root?.amountOut ?? root?.outputAmount ?? root?.toAmount ?? root?.buyAmount ?? root?.amount_out;
  if (fallback && typeof fallback === "object") {
    const amount = normalizeOutputAmount(
      fallback.amount ?? fallback.value ?? fallback.formattedAmount
    );
    if (amount) return { amount, token: fallback.token || fallback.symbol || tokenOut };
  }
  const amount = normalizeOutputAmount(fallback);
  return amount ? { amount, token: tokenOut } : { amount: "", token: tokenOut };
}

function feeRows(estimate) {
  const root = quoteRoot(estimate);
  const rows = Array.isArray(root?.fees) ? root.fees : [];
  return rows.map((fee, index) => ({
    id: `${fee?.type || fee?.name || "fee"}-${index}`,
    label: fee?.name || fee?.type || "Fee",
    value: fee?.amount
      ? `${fee.amount}${fee.token ? ` ${fee.token}` : ""}`
      : fee?.formatted || "Included"
  }));
}

function initialSwapValues(action) {
  const args = action?.tool === "prepare_swap" ? action.args || {} : {};
  const tokenIn = TOKENS.includes(args.tokenIn) ? args.tokenIn : DEFAULT_IN;
  const tokenOut =
    TOKENS.includes(args.tokenOut) && args.tokenOut !== tokenIn
      ? args.tokenOut
      : TOKENS.find((item) => item !== tokenIn) || DEFAULT_OUT;
  return {
    tokenIn,
    tokenOut,
    amount: action?.tool === "prepare_swap" ? cleanAmount(args.amount || "1") : "1",
    slippageBps: [50, 100, 300].includes(Number(args.slippageBps)) ? Number(args.slippageBps) : 100
  };
}

export default function SwapPanel({ walletSnapshot, onActivitySaved, copilotAction }) {
  const { connector } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const initialValues = initialSwapValues(copilotAction);
  const actionLock = useRef(false);
  const [tokenIn, setTokenIn] = useState(initialValues.tokenIn);
  const [tokenOut, setTokenOut] = useState(initialValues.tokenOut);
  const [amount, setAmount] = useState(initialValues.amount);
  const [slippageBps, setSlippageBps] = useState(initialValues.slippageBps);
  const [quote, setQuote] = useState(null);
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [quoteError, setQuoteError] = useState("");

  const inputAsset = useMemo(() => getAsset(walletSnapshot, tokenIn), [walletSnapshot, tokenIn]);
  const outputAsset = useMemo(() => getAsset(walletSnapshot, tokenOut), [walletSnapshot, tokenOut]);
  const balanceKnown = walletSnapshot?.onArc && inputAsset?.status === "ready";
  const balance = Number(inputAsset?.balanceValue || 0);
  const insufficient = balanceKnown && Number(amount || 0) > balance + 0.0000001;
  const quotedOutput = useMemo(() => outputQuote(quote, tokenOut), [quote, tokenOut]);
  const output = quotedOutput.amount
    ? `${quotedOutput.amount} ${quotedOutput.token || tokenOut}`
    : "";
  const fees = useMemo(() => feeRows(quote), [quote]);
  const busy = switching || ["switching", "swapping", "quoting"].includes(status);
  const reviewIdentity = JSON.stringify([
    walletSnapshot?.address,
    arcTestnet.id,
    tokenIn,
    tokenOut,
    amount,
    slippageBps
  ]);
  const canReview =
    CONFIGURED &&
    walletSnapshot?.isSignedIn &&
    connector &&
    validAmount(amount) &&
    tokenIn !== tokenOut &&
    !insufficient;
  const hasLiveQuote = Boolean(quote && quotedOutput.amount);

  const buildParams = useCallback(
    (client) => ({
      from: { adapter: client.adapter, chain: ARC_BRIDGE_DESTINATION.appKitChain },
      tokenIn: tokenIdentifier(tokenIn),
      tokenOut: tokenIdentifier(tokenOut),
      amountIn: amount,
      config: { slippageBps, allowanceStrategy: "approve" }
    }),
    [amount, slippageBps, tokenIn, tokenOut]
  );

  const resetReview = () => {
    setQuote(null);
    setResult(null);
    setError("");
    setQuoteError("");
    setStatus("idle");
  };

  const prepare = async (onSubmitted = () => {}) => {
    if (!canReview)
      throw new Error(
        insufficient ? `Insufficient ${tokenIn} balance.` : "Enter a valid swap amount and pair."
      );
    const arcChain = MULTICHAIN_WALLET_CHAINS.find((item) => item.id === arcTestnet.id);
    if (!arcChain) throw new Error("Arc network configuration is unavailable.");
    setStatus("switching");
    const { provider } = await switchWalletNetwork({
      connector,
      chain: arcChain,
      switchChainAsync
    });
    await assertWalletIdentity(provider, walletSnapshot.address, arcTestnet.id);
    parseTransferAmount(
      amount,
      ARC_PORTFOLIO_TOKENS.find((token) => token.symbol === tokenIn)?.decimals || 6
    );
    const client = await createArcAppKitClient(
      guardedWalletProvider(provider, walletSnapshot.address, [arcTestnet.id], onSubmitted)
    );
    return { client, provider, params: buildParams(client) };
  };

  const handleReview = async () => {
    if (actionLock.current || result) return;
    actionLock.current = true;
    setError("");
    setQuoteError("");
    setResult(null);
    try {
      const { client, params } = await prepare();
      setStatus("quoting");
      const nextQuote = await client.kit.estimateSwap(params);
      const parsed = outputQuote(nextQuote, tokenOut);
      if (!parsed.amount) throw new Error("Circle returned a quote without an output amount.");
      const outputDecimals =
        ARC_PORTFOLIO_TOKENS.find((token) => token.symbol === tokenOut)?.decimals || 6;
      setQuote({
        ...nextQuote,
        review: { identity: reviewIdentity, createdAt: Date.now() },
        minimumOutput: minimumSwapOutput(nextQuote, outputDecimals, slippageBps)
      });
      setStatus("ready");
    } catch (nextError) {
      setQuote(null);
      setStatus("error");
      setError(
        formatAppKitError(nextError, "No live swap route is available for this pair right now.")
      );
    } finally {
      actionLock.current = false;
    }
  };

  const handleSwap = async () => {
    if (!hasLiveQuote || !canReview || actionLock.current || result) return;
    actionLock.current = true;
    setError("");
    setQuoteError("");
    try {
      assertReview(quote.review, reviewIdentity);
      const { client, provider, params } = await prepare((hash) => {
        setResult({ state: "pending", txHash: hash });
        onActivitySaved?.(
          createWalletActionRecord({
            walletAddress: walletSnapshot.address,
            type: "Swap",
            kind: "swap",
            amount: `${amount} ${tokenIn}`,
            chain: arcTestnet.name,
            chainId: arcTestnet.id,
            sender: walletSnapshot.address,
            receiver: walletSnapshot.address,
            status: "Submitted",
            txHash: hash,
            explorerUrl: explorerUrl(null, hash),
            summary: "Swap transaction submitted; verify completion on the explorer.",
            metadata: { operation: "swap" }
          })
        );
      });
      await assertWalletIdentity(provider, walletSnapshot.address, arcTestnet.id);
      assertReview(quote.review, reviewIdentity);
      setStatus("swapping");
      const nextResult = await client.kit.swap({
        ...params,
        config: { ...params.config, stopLimit: quote.minimumOutput }
      });
      setResult(nextResult);
      const failed = nextResult?.state === "error";
      const hash = txHash(nextResult);
      const link = explorerUrl(nextResult, hash);
      const finalStatus = failed
        ? "Failed"
        : nextResult?.state === "success"
          ? "Confirmed"
          : "Submitted";
      setStatus(failed ? "error" : nextResult?.state === "success" ? "success" : "submitted");
      onActivitySaved?.(
        createWalletActionRecord({
          walletAddress: walletSnapshot.address,
          type: "Swap",
          kind: "swap",
          amount: `${amount} ${tokenIn} → ${output || tokenOut}`,
          chain: arcTestnet.name,
          chainId: arcTestnet.id,
          sender: walletSnapshot.address,
          receiver: walletSnapshot.address,
          status: finalStatus,
          txHash: hash,
          explorerUrl: link,
          summary: `Swap ${amount} ${tokenIn} for ${output || tokenOut} on ${arcTestnet.name}`,
          metadata: { operation: "swap", tokenIn, tokenOut, slippageBps, estimateOutput: output }
        })
      );
      if (failed) setError("Circle returned a failed swap result. No success is being claimed.");
    } catch (nextError) {
      setStatus("error");
      setQuote(null);
      setError(
        formatAppKitError(
          nextError,
          "Unable to submit this swap. Check Activity before retrying if your wallet already submitted a transaction."
        )
      );
    } finally {
      actionLock.current = false;
    }
  };

  if (!walletSnapshot?.isSignedIn)
    return (
      <section className="transaction-panel">
        <div className="transaction-empty">
          <strong>Connect your wallet to swap.</strong>
        </div>
      </section>
    );

  const receiveValue =
    status === "quoting"
      ? "Getting quote…"
      : quotedOutput.amount || (quoteError ? "Unavailable" : "0.00");

  return (
    <section className="transaction-panel">
      <header className="transaction-page-head">
        <div>
          <span>Arc liquidity</span>
          <h2>Swap</h2>
          <p>
            Request a live quote, review the minimum output and fees, then approve in your wallet.
          </p>
        </div>
        <div className="transaction-network-pill">
          <i />
          {arcTestnet.name}
          {Number(chainId) !== Number(arcTestnet.id) ? <small>Switches on review</small> : null}
        </div>
      </header>

      {!CONFIGURED ? (
        <div className="transaction-alert is-error">
          <strong>Swap configuration incomplete</strong>
          <span>At least two supported Arc assets and Circle App Kit are required.</span>
        </div>
      ) : null}

      <div className="transaction-swap-shell">
        <div className="transaction-token-box">
          <header>
            <span>You pay</span>
            <small>Balance {inputAsset?.balance || "syncing…"}</small>
          </header>
          <div>
            <input
              aria-label="Swap amount"
              disabled={busy || Boolean(result)}
              value={amount}
              onChange={(event) => {
                setAmount(cleanAmount(event.target.value));
                resetReview();
              }}
              inputMode="decimal"
              placeholder="0.00"
            />
            <label>
              <b>{META[tokenIn]?.mark}</b>
              <select
                aria-label="Pay token"
                disabled={busy || Boolean(result)}
                value={tokenIn}
                onChange={(event) => {
                  const next = event.target.value;
                  if (next === tokenOut) setTokenOut(tokenIn);
                  setTokenIn(next);
                  resetReview();
                }}
              >
                {TOKENS.map((token) => (
                  <option key={token}>{token}</option>
                ))}
              </select>
            </label>
          </div>
          {balanceKnown && tokenIn !== "USDC" ? (
            <button
              type="button"
              disabled={busy || Boolean(result)}
              onClick={() => {
                setAmount(String(balance));
                resetReview();
              }}
            >
              Max
            </button>
          ) : null}
        </div>

        <button
          type="button"
          className="transaction-swap-arrow"
          onClick={() => {
            setTokenIn(tokenOut);
            setTokenOut(tokenIn);
            resetReview();
          }}
          disabled={busy || Boolean(result)}
          aria-label="Reverse swap pair"
        >
          <FeatureIcon name="swap" />
        </button>

        <div className="transaction-token-box is-output">
          <header>
            <span>You receive</span>
            <small>Balance {outputAsset?.balance || "syncing…"}</small>
          </header>
          <div>
            <strong
              className={status === "quoting" ? "is-loading" : quoteError ? "is-unavailable" : ""}
            >
              {receiveValue}
            </strong>
            <label>
              <b>{META[tokenOut]?.mark}</b>
              <select
                aria-label="Receive token"
                disabled={busy || Boolean(result)}
                value={tokenOut}
                onChange={(event) => {
                  const next = event.target.value;
                  if (next === tokenIn) setTokenIn(tokenOut);
                  setTokenOut(next);
                  resetReview();
                }}
              >
                {TOKENS.map((token) => (
                  <option key={token}>{token}</option>
                ))}
              </select>
            </label>
          </div>
          {hasLiveQuote ? (
            <small className="transaction-live-quote-label">
              Live Circle estimate · {quotedOutput.token || tokenOut}
            </small>
          ) : Number(chainId) !== Number(arcTestnet.id) && canReview ? (
            <small className="transaction-live-quote-label">
              Switch to Arc on review to load the quote.
            </small>
          ) : null}
        </div>
      </div>

      <div className="transaction-slippage">
        <span>Max slippage</span>
        {[50, 100, 300].map((value) => (
          <button
            key={value}
            type="button"
            disabled={busy || Boolean(result)}
            className={slippageBps === value ? "is-active" : ""}
            onClick={() => {
              setSlippageBps(value);
              resetReview();
            }}
          >
            {value / 100}%
          </button>
        ))}
      </div>

      {insufficient ? (
        <div className="transaction-alert is-error">
          <strong>Insufficient {tokenIn}</strong>
          <span>Available {inputAsset?.balance || "0"}</span>
        </div>
      ) : null}
      {quoteError ? (
        <div className="transaction-alert is-error">
          <strong>Live quote unavailable</strong>
          <span>{quoteError}</span>
        </div>
      ) : null}

      {hasLiveQuote ? (
        <div className="transaction-review-card">
          <header>
            <div>
              <span>Swap review</span>
              <strong>
                {amount} {tokenIn} → {output}
              </strong>
            </div>
            <span className="is-ready">Live quote</span>
          </header>
          <div className="transaction-fees">
            <div>
              <span>Minimum received</span>
              <strong>
                {quote.minimumOutput} {tokenOut}
              </strong>
            </div>
            {fees.length ? (
              fees.map((row) => (
                <div key={row.id}>
                  <span>{row.label}</span>
                  <strong>{row.value}</strong>
                </div>
              ))
            ) : (
              <div>
                <span>Slippage limit</span>
                <strong>{slippageBps / 100}%</strong>
              </div>
            )}
          </div>
          <p>Nothing is signed until you confirm the transaction in your connected wallet.</p>
        </div>
      ) : null}

      {result ? (
        <div className="transaction-result">
          <div>
            <span>Swap status</span>
            <strong>
              {result?.state === "error"
                ? "Failed"
                : result?.state === "success"
                  ? "Confirmed"
                  : "Submitted"}
            </strong>
          </div>
          {txHash(result) ? (
            <div>
              <span>Transaction</span>
              <code>{txHash(result)}</code>
            </div>
          ) : null}
          {explorerUrl(result, txHash(result)) ? (
            <a href={explorerUrl(result, txHash(result))} target="_blank" rel="noreferrer">
              Open transaction ↗
            </a>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <div className="transaction-alert is-error">
          <strong>Swap needs attention</strong>
          <span>{error}</span>
        </div>
      ) : null}

      {result ? (
        <button
          type="button"
          className="transaction-secondary"
          onClick={resetReview}
          disabled={busy}
        >
          Start another swap
        </button>
      ) : null}
      <div className="transaction-actions">
        <button
          type="button"
          className="transaction-secondary"
          onClick={handleReview}
          disabled={!canReview || busy || Boolean(result)}
        >
          {status === "switching"
            ? "Switching network…"
            : status === "quoting"
              ? "Getting quote…"
              : hasLiveQuote
                ? "Refresh quote"
                : "Review swap"}
        </button>
        <button
          type="button"
          className="transaction-primary"
          onClick={handleSwap}
          disabled={!hasLiveQuote || !canReview || busy || Boolean(result)}
        >
          {status === "swapping" ? "Swapping…" : "Confirm in wallet"}
        </button>
      </div>
    </section>
  );
}
