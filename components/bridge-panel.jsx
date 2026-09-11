import { useEffect, useMemo, useState } from "react";
import { formatUnits } from "viem";
import { useAccount, useChainId, usePublicClient, useSwitchChain } from "wagmi";
import { getPrimaryExplorerUrl, getPrimaryTxHash } from "../lib/arc-app-kit";
import {
  APP_KIT_EVM_CHAIN_OPTIONS,
  ARC_APP_KIT_READY,
  ARC_MAINNET_REQUESTED,
  ARC_USDC_ERC20_ADDRESS,
  MULTICHAIN_WALLET_CHAINS,
  arcTestnet
} from "../lib/arc-chain";
import { createArcBridgeClient, formatBridgeError, summarizeBridgeFees } from "../lib/arc-bridge";
import { createWalletActionRecord } from "../lib/local-activity";
import { switchWalletNetwork } from "../lib/wallet-network";
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
  const next = String(value || "").replace(/[^\d.]/g, "");
  const [whole, ...rest] = next.split(".");
  return rest.length ? `${whole}.${rest.join("").slice(0, 6)}` : whole;
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
  if (result.state === "error") return "Failed";
  if (result.state === "success") return "Confirmed";
  return "Submitted";
}

export default function BridgePanel({ walletSnapshot, onActivitySaved, copilotAction }) {
  const { connector } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const initialValues = initialBridgeValues(chainId, copilotAction);
  const [sourceId, setSourceId] = useState(initialValues.sourceId);
  const [destinationId, setDestinationId] = useState(initialValues.destinationId);
  const [amount, setAmount] = useState(initialValues.amount);
  const [quote, setQuote] = useState(null);
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [balance, setBalance] = useState({ status: "idle", value: 0 });

  const source = useMemo(() => optionById(sourceId), [sourceId]);
  const destination = useMemo(() => optionById(destinationId), [destinationId]);
  const sourceChain = useMemo(() => wagmiChainById(source.id), [source.id]);
  const destinationChain = useMemo(() => wagmiChainById(destination.id), [destination.id]);
  const publicClient = usePublicClient({ chainId: source.id });
  const busy =
    switching || ["switching", "quoting", "bridging", "destination-switching"].includes(status);
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
    const provider = await ensureSource();
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
    setQuote(nextQuote);
    setStatus("ready");
    return { client, quote: nextQuote };
  };

  const handleReview = async () => {
    setError("");
    setResult(null);
    try {
      await buildQuote();
    } catch (nextError) {
      setQuote(null);
      setStatus("error");
      setError(formatBridgeError(nextError));
    }
  };

  const handleBridge = async () => {
    if (!canReview || insufficient) return;
    setError("");
    try {
      const provider = await ensureSource();
      const client = await createArcBridgeClient(provider);
      setStatus("bridging");
      const nextResult = await client.kit.bridge({
        from: { adapter: client.adapter, chain: source.appKitChain },
        to: {
          adapter: client.adapter,
          chain: destination.appKitChain,
          recipientAddress: walletSnapshot.address
        },
        amount
      });
      setResult(nextResult);
      const finalStatus = resultState(nextResult);
      setStatus(
        finalStatus === "Failed" ? "error" : finalStatus === "Confirmed" ? "success" : "submitted"
      );
      const hash = getPrimaryTxHash(nextResult);
      const explorerUrl = getPrimaryExplorerUrl(nextResult);
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
          status: finalStatus,
          txHash: hash,
          explorerUrl,
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
      if (finalStatus === "Failed")
        setError("Circle returned a failed bridge result. No success is being claimed.");
    } catch (nextError) {
      setStatus("error");
      setError(formatBridgeError(nextError));
    }
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
                disabled={busy}
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
          disabled={busy}
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
                disabled={busy || source.id === item.id}
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
              : "Checking source balance…"}
          </span>
        </div>
        <div>
          <input
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
            Final execution is still controlled by your wallet. Review every approval and signature.
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
          {getPrimaryTxHash(result) ? (
            <div>
              <span>Transaction</span>
              <code>{getPrimaryTxHash(result)}</code>
            </div>
          ) : null}
          {getPrimaryExplorerUrl(result) ? (
            <a href={getPrimaryExplorerUrl(result)} target="_blank" rel="noreferrer">
              Open transaction ↗
            </a>
          ) : null}
          <button
            type="button"
            className="transaction-secondary"
            onClick={switchToDestination}
            disabled={busy}
          >
            Switch wallet to {destination.shortName}
          </button>
        </div>
      ) : null}

      <div className="transaction-actions">
        <button
          type="button"
          className="transaction-secondary"
          onClick={handleReview}
          disabled={!canReview || insufficient || busy}
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
          disabled={!quote || insufficient || busy}
        >
          {status === "bridging" ? "Bridging…" : "Confirm in wallet"}
        </button>
      </div>
    </section>
  );
}
