import { useEffect, useMemo, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useAccount, useChainId, usePublicClient, useSwitchChain } from "wagmi";

import {
  APP_KIT_EVM_CHAIN_OPTIONS,
  ARC_APP_KIT_READY,
  ARC_MAINNET_REQUESTED,
  ARC_NETWORK_MODE,
  ARC_USDC_ERC20_ADDRESS,
  MULTICHAIN_WALLET_CHAINS,
  arcTestnet
} from "../lib/arc-chain";
import { createArcBridgeClient, formatBridgeError, summarizeBridgeFees } from "../lib/arc-bridge";
import { createWalletActionRecord } from "../lib/local-activity";
import { switchWalletNetwork } from "../lib/wallet-network";
import {
  assertReview,
  assertWalletIdentity,
  parseTransferAmount,
  guardedWalletProvider
} from "../lib/transaction-safety.mjs";
import {
  recoveryKey,
  serializeCheckpoint,
  parseCheckpoint,
  canResumeBridge,
  bridgeTransferStep
} from "../lib/bridge-recovery.mjs";
import { FeatureIcon } from "./wallet-sidebar";

const OPTIONS = APP_KIT_EVM_CHAIN_OPTIONS;
const CONFIGURED =
  (!ARC_MAINNET_REQUESTED || ARC_APP_KIT_READY) &&
  OPTIONS.length >= 2 &&
  OPTIONS.every((item) => item.appKitChain);
const USDC_BY_CHAIN = ARC_MAINNET_REQUESTED
  ? {
      [arcTestnet.id]: ARC_USDC_ERC20_ADDRESS,
      1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    }
  : {
      [arcTestnet.id]: ARC_USDC_ERC20_ADDRESS,
      11155111: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
    };

const BALANCE_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  }
];

function cleanAmount(value) {
  return String(value || "").trim();
}

function validAmount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function optionById(id) {
  return OPTIONS.find((item) => item.id === Number(id)) || OPTIONS[0];
}

function wagmiChainById(id) {
  return MULTICHAIN_WALLET_CHAINS.find((item) => item.id === Number(id)) || null;
}

function destinationFor(sourceId) {
  if (Number(sourceId) !== Number(arcTestnet.id)) return arcTestnet.id;
  return OPTIONS.find((item) => item.id !== arcTestnet.id)?.id || arcTestnet.id;
}

function chainIdForCopilotNetwork(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "arc") return arcTestnet.id;
  if (normalized.includes("ethereum")) return ARC_MAINNET_REQUESTED ? 1 : 11155111;
  if (normalized.includes("base")) return ARC_MAINNET_REQUESTED ? 8453 : 84532;
  return null;
}

function initialBridgeValues(chainId, action) {
  const walletSource = OPTIONS.some((item) => item.id === chainId) ? chainId : arcTestnet.id;
  if (action?.tool !== "prepare_bridge") {
    return { sourceId: walletSource, destinationId: destinationFor(walletSource), amount: "" };
  }
  const requestedSource = chainIdForCopilotNetwork(action?.args?.sourceNetwork);
  const sourceId = OPTIONS.some((item) => item.id === requestedSource)
    ? requestedSource
    : walletSource;
  const requestedDestination = chainIdForCopilotNetwork(action?.args?.destinationNetwork);
  const destinationId =
    OPTIONS.some((item) => item.id === requestedDestination) && requestedDestination !== sourceId
      ? requestedDestination
      : destinationFor(sourceId);
  return {
    sourceId,
    destinationId,
    amount: cleanAmount(action?.args?.amount || "")
  };
}

function chainMark(id) {
  if (Number(id) === Number(arcTestnet.id)) return "A";
  if ([1, 11155111].includes(Number(id))) return "Ξ";
  return "B";
}

function feeLabel(estimate) {
  const rows = summarizeBridgeFees(estimate || {}).slice(0, 6);
  return rows.length ? rows : [{ label: "Network + bridge fees", value: "Calculated by Circle" }];
}

function resultState(result) {
  if (!result) return "";
  if (result.state === "error") return "Needs attention";
  if (result.state === "success") return "Confirmed";
  return "Submitted";
}

export default function BridgePanel({ walletSnapshot, onActivitySaved, copilotAction }) {
  const { connector } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const storageKey = recoveryKey(ARC_NETWORK_MODE, walletSnapshot?.address);
  const [restored] = useState(() => {
    if (typeof window === "undefined") return null;
    try {
      return parseCheckpoint(
        localStorage.getItem(storageKey),
        walletSnapshot?.address,
        OPTIONS.map((item) => item.id)
      );
    } catch {
      return null;
    }
  });
  const initialValues = restored || initialBridgeValues(chainId, copilotAction);
  const actionLock = useRef(false);
  const progress = useRef(restored?.result || null);
  const [sourceId, setSourceId] = useState(initialValues.sourceId);
  const [destinationId, setDestinationId] = useState(initialValues.destinationId);
  const [amount, setAmount] = useState(initialValues.amount);
  const [quote, setQuote] = useState(null);
  const [result, setResult] = useState(restored?.result || null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [balance, setBalance] = useState({ status: "idle", value: 0 });

  const source = useMemo(() => optionById(sourceId), [sourceId]);
  const destination = useMemo(() => optionById(destinationId), [destinationId]);
  const sourceChain = useMemo(() => wagmiChainById(source.id), [source.id]);
  const destinationChain = useMemo(() => wagmiChainById(destination.id), [destination.id]);
  const publicClient = usePublicClient({ chainId: source.id });
  const busy =
    switching ||
    ["switching", "quoting", "bridging", "destination-switching", "recovering"].includes(status);
  const reviewIdentity = JSON.stringify([walletSnapshot?.address, sourceId, destinationId, amount]);
  const canReview =
    CONFIGURED &&
    Boolean(
      connector && walletSnapshot?.address && validAmount(amount) && source.id !== destination.id
    );
  const insufficient =
    balance.status === "ready" && Number(amount || 0) > Number(balance.value || 0) + 0.0000001;

  useEffect(() => {
    if (!OPTIONS.some((item) => item.id === chainId) || busy || quote || result) return;
    // The connector chain is an external wallet state source, not derived React state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSourceId(chainId);
    setDestinationId((current) => (current === chainId ? destinationFor(chainId) : current));
  }, [chainId, busy, quote, result]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const token = USDC_BY_CHAIN[source.id];
      if (!walletSnapshot?.address || !publicClient || !token) {
        setBalance({ status: "idle", value: 0 });
        return;
      }
      setBalance((current) => ({ ...current, status: "loading" }));
      try {
        const raw = await publicClient.readContract({
          address: token,
          abi: BALANCE_ABI,
          functionName: "balanceOf",
          args: [walletSnapshot.address]
        });
        if (!cancelled) setBalance({ status: "ready", value: Number(formatUnits(raw, 6)) });
      } catch {
        if (!cancelled) setBalance({ status: "error", value: 0 });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [walletSnapshot?.address, publicClient, source.id]);

  const resetQuote = () => {
    setQuote(null);
    setResult(null);
    setStatus("idle");
    setError("");
  };

  const ensureSource = async () => {
    if (!sourceChain) throw new Error("Source network configuration is unavailable.");
    setStatus("switching");
    const switched = await switchWalletNetwork({ connector, chain: sourceChain, switchChainAsync });
    return switched.provider;
  };

  const buildQuote = async () => {
    if (!canReview || insufficient)
      throw new Error(
        insufficient
          ? `Insufficient USDC on ${source.shortName}.`
          : "Enter a valid USDC amount and route."
      );
    parseTransferAmount(amount);
    const provider = await ensureSource();
    await assertWalletIdentity(provider, walletSnapshot.address, source.id);
    setStatus("quoting");
    const client = await createArcBridgeClient(provider);
    const nextQuote = await client.kit.estimateBridge({
      from: { adapter: client.adapter, chain: source.appKitChain },
      to: {
        adapter: client.adapter,
        chain: destination.appKitChain,
        recipientAddress: walletSnapshot.address
      },
      amount
    });
    setQuote({ ...nextQuote, review: { identity: reviewIdentity, createdAt: Date.now() } });
    setStatus("ready");
    return { client, quote: nextQuote };
  };

  const handleReview = async () => {
    if (actionLock.current || result) return;
    actionLock.current = true;
    setError("");
    setResult(null);
    try {
      await buildQuote();
    } catch (nextError) {
      setQuote(null);
      setStatus("error");
      setError(formatBridgeError(nextError));
    } finally {
      actionLock.current = false;
    }
  };

  const saveProgress = (nextResult) => {
    progress.current = nextResult;
    setResult(nextResult);
    try {
      localStorage.setItem(
        storageKey,
        serializeCheckpoint({
          address: walletSnapshot.address,
          sourceId: source.id,
          destinationId: destination.id,
          amount,
          result: nextResult
        })
      );
    } catch {
      setError(
        "Keep this page open and save the transaction links; this browser could not save bridge recovery data."
      );
    }
    const step = bridgeTransferStep(nextResult);
    if (step?.txHash)
      onActivitySaved?.(
        createWalletActionRecord({
          walletAddress: walletSnapshot.address,
          type: "Bridge",
          kind: "bridge",
          amount: `${amount} USDC`,
          chain: `${source.name} → ${destination.name}`,
          chainId: source.id,
          sender: walletSnapshot.address,
          receiver: walletSnapshot.address,
          recipient: walletSnapshot.address,
          status: nextResult.state === "success" ? "Confirmed" : "Submitted",
          txHash: step.txHash,
          explorerUrl: step.explorerUrl || `${source.explorerUrl}/tx/${step.txHash}`,
          summary: `Bridge ${amount} USDC from ${source.name} to ${destination.name}`,
          metadata: {
            operation: "bridge",
            sourceChainId: source.id,
            destinationChainId: destination.id,
            sourceNetwork: source.name,
            destinationNetwork: destination.name
          }
        })
      );
  };

  const executeBridge = async (recover = false) => {
    if (actionLock.current || (recover ? !canResumeBridge(result) : !canReview || !quote || result))
      return;
    actionLock.current = true;
    setError("");
    let client;
    let listener;
    try {
      if (
        recover &&
        (result.source?.address?.toLowerCase() !== walletSnapshot.address.toLowerCase() ||
          (result.destination?.recipientAddress || result.destination?.address)?.toLowerCase() !==
            walletSnapshot.address.toLowerCase() ||
          Number(result.source?.chain?.chainId) !== source.id ||
          Number(result.destination?.chain?.chainId) !== destination.id ||
          result.token !== "USDC" ||
          parseTransferAmount(result.amount).units !== parseTransferAmount(amount).units)
      )
        throw new Error("Bridge checkpoint does not match this wallet, route, or amount.");
      if (!recover) assertReview(quote.review, reviewIdentity);
      const provider = await ensureSource();
      await assertWalletIdentity(provider, walletSnapshot.address, source.id);
      if (!recover) assertReview(quote.review, reviewIdentity);
      const guarded = guardedWalletProvider(
        provider,
        walletSnapshot.address,
        [source.id, destination.id],
        (hash) => {
          const current = progress.current || { state: "pending", steps: [] };
          if (!current.steps.some((step) => step.txHash === hash)) {
            saveProgress({
              ...current,
              state: "pending",
              steps: [
                ...current.steps,
                {
                  name: "Submitted transaction",
                  state: "pending",
                  txHash: hash,
                  explorerUrl: `${source.explorerUrl}/tx/${hash}`
                }
              ]
            });
          }
        }
      );
      client = await createArcBridgeClient(guarded);
      listener = (payload) => {
        const step = payload?.values;
        if (!step?.name) return;
        const current = progress.current || { state: "pending", steps: [] };
        const steps = current.steps.filter(
          (item) => item.name !== step.name && (!step.txHash || item.txHash !== step.txHash)
        );
        saveProgress({ ...current, state: "pending", steps: [...steps, step] });
      };
      client.kit.on("*", listener);
      setStatus(recover ? "recovering" : "bridging");
      const nextResult = recover
        ? await client.kit.retryBridge(result, { from: client.adapter, to: client.adapter })
        : await client.kit.bridge({
            from: { adapter: client.adapter, chain: source.appKitChain },
            to: {
              adapter: client.adapter,
              chain: destination.appKitChain,
              recipientAddress: walletSnapshot.address
            },
            amount,
            ...(quote.quote ? { quote: quote.quote } : {}),
            config: { batchTransactions: false }
          });
      saveProgress(nextResult);
      setStatus(nextResult.state === "success" ? "success" : "submitted");
      if (nextResult.state !== "success")
        setError(
          "The bridge has not completed on the destination. Check the steps below before taking another action."
        );
    } catch (nextError) {
      setStatus("error");
      setError(
        progress.current?.steps?.some((step) => step.txHash)
          ? "A transaction was submitted. Keep these links and check its status before starting another bridge. " +
              formatBridgeError(nextError)
          : formatBridgeError(nextError)
      );
    } finally {
      if (client && listener) client.kit.off("*", listener);
      actionLock.current = false;
    }
  };

  const handleBridge = () => executeBridge(false);
  const clearCompleted = () => {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* Storage may be unavailable. */
    }
    progress.current = null;
    resetQuote();
  };

  const switchToDestination = async () => {
    if (!destinationChain) return;
    setError("");
    setStatus("destination-switching");
    try {
      await switchWalletNetwork({ connector, chain: destinationChain, switchChainAsync });
      setStatus(result?.state === "success" ? "success" : "submitted");
    } catch (nextError) {
      setStatus(result?.state === "success" ? "success" : "submitted");
      setError(formatBridgeError(nextError));
    }
  };

  return (
    <section className="transaction-panel">
      <header className="transaction-page-head">
        <div>
          <span>Cross-chain USDC</span>
          <h2>Bridge</h2>
          <p>
            Review the route and fees first. Lumexa always switches the wallet to the exact source
            chain before Circle prepares or submits the bridge.
          </p>
        </div>
        <div className="transaction-route-pill">
          <b>{chainMark(source.id)}</b>
          {source.shortName}
          <span>→</span>
          <b>{chainMark(destination.id)}</b>
          {destination.shortName}
        </div>
      </header>

      {!CONFIGURED ? (
        <div className="transaction-alert is-error">
          <strong>Bridge configuration incomplete</strong>
          <span>Circle App Kit route configuration is unavailable in this environment.</span>
        </div>
      ) : null}

      <div className="transaction-bridge-grid">
        <div className="transaction-route-box">
          <label>From</label>
          <div className="transaction-chain-list">
            {OPTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={busy || Boolean(result)}
                className={source.id === item.id ? "is-active" : ""}
                onClick={() => {
                  setSourceId(item.id);
                  if (destinationId === item.id) setDestinationId(destinationFor(item.id));
                  resetQuote();
                }}
              >
                <b>{chainMark(item.id)}</b>
                <span>
                  <strong>{item.shortName}</strong>
                  <small>{item.gasToken} gas</small>
                </span>
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          className="transaction-route-swap"
          disabled={busy || Boolean(result)}
          onClick={() => {
            const previous = source.id;
            setSourceId(destination.id);
            setDestinationId(previous);
            resetQuote();
          }}
        >
          <FeatureIcon name="swap" />
        </button>
        <div className="transaction-route-box">
          <label>To</label>
          <div className="transaction-chain-list">
            {OPTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={busy || Boolean(result) || source.id === item.id}
                className={destination.id === item.id ? "is-active" : ""}
                onClick={() => {
                  setDestinationId(item.id);
                  resetQuote();
                }}
              >
                <b>{chainMark(item.id)}</b>
                <span>
                  <strong>{item.shortName}</strong>
                  <small>{item.id === source.id ? "Source" : "Destination"}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="transaction-amount-card">
        <div>
          <label>Amount</label>
          <span>
            {balance.status === "ready"
              ? `Available ${balance.value.toLocaleString(undefined, { maximumFractionDigits: 6 })} USDC`
              : balance.status === "error"
                ? "Balance unavailable — retry review"
                : "Checking source balance…"}
          </span>
        </div>
        <div>
          <input
            aria-label="Bridge amount"
            disabled={busy || Boolean(result)}
            value={amount}
            onChange={(event) => {
              setAmount(cleanAmount(event.target.value));
              resetQuote();
            }}
            inputMode="decimal"
            placeholder="0.00"
          />
          <strong>USDC</strong>
        </div>
        {insufficient ? (
          <small className="is-error">Amount exceeds the USDC balance on {source.shortName}.</small>
        ) : null}
      </div>

      {quote ? (
        <div className="transaction-review-card">
          <header>
            <div>
              <span>Route review</span>
              <strong>{amount} USDC</strong>
            </div>
            <span className="is-ready">Quote ready</span>
          </header>
          <div className="transaction-review-route">
            <strong>{source.name}</strong>
            <span>→</span>
            <strong>{destination.name}</strong>
          </div>
          <div className="transaction-fees">
            {feeLabel(quote).map((row, index) => (
              <div key={`${row.label}-${index}`}>
                <span>{row.label}</span>
                <strong>{row.value}</strong>
              </div>
            ))}
          </div>
          <p>
            Recipient: {walletSnapshot.address}. Keep this page open until destination confirmation.
            Reviews expire after 60 seconds. Your wallet approves each step.
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="transaction-alert is-error">
          <strong>Bridge needs attention</strong>
          <span>{error}</span>
        </div>
      ) : null}

      {result ? (
        <div className="transaction-result">
          <div>
            <span>Bridge status</span>
            <strong>{resultState(result)}</strong>
          </div>
          {(result.steps || []).map((step, index) => (
            <div key={`${step.name}-${index}`}>
              <span>
                {step.name}: {step.state}
              </span>
              {step.txHash ? (
                <a
                  href={step.explorerUrl || `${source.explorerUrl}/tx/${step.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <code>{step.txHash}</code> ↗
                </a>
              ) : null}
            </div>
          ))}
          {canResumeBridge(result) ? (
            <button
              type="button"
              className="transaction-primary"
              disabled={busy}
              onClick={() => executeBridge(true)}
            >
              {status === "recovering" ? "Resuming…" : "Resume destination delivery"}
            </button>
          ) : null}
          <button
            type="button"
            className="transaction-secondary"
            onClick={switchToDestination}
            disabled={busy}
          >
            Switch wallet to {destination.shortName}
          </button>
          {result.state === "success" ? (
            <button
              type="button"
              className="transaction-secondary"
              onClick={clearCompleted}
              disabled={busy}
            >
              Start another bridge
            </button>
          ) : null}
          {result.state !== "success" && !busy ? (
            <button
              type="button"
              className="transaction-secondary"
              onClick={() => {
                if (
                  window.confirm(
                    "Only clear this checkpoint after checking every transaction above. This does not cancel or recover a bridge. Save the links before continuing."
                  )
                )
                  clearCompleted();
              }}
            >
              I checked the transactions; clear this view
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="transaction-actions">
        <button
          type="button"
          className="transaction-secondary"
          onClick={handleReview}
          disabled={!canReview || insufficient || busy || Boolean(result)}
        >
          {status === "quoting" || status === "switching"
            ? "Preparing review…"
            : quote
              ? "Refresh quote"
              : "Review bridge"}
        </button>
        <button
          type="button"
          className="transaction-primary"
          onClick={handleBridge}
          disabled={!quote || insufficient || busy || Boolean(result)}
        >
          {status === "bridging" ? "Bridging…" : "Confirm in wallet"}
        </button>
      </div>
    </section>
  );
}
