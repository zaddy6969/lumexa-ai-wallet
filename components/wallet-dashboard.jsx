import { useQuery } from "@tanstack/react-query";
import { memo, useCallback, useState } from "react";
import { MULTICHAIN_WALLET_CHAINS, arcActiveChain } from "../lib/arc-chain";
import { FeatureIcon } from "./wallet-sidebar";

function shortAddress(value) {
  if (!value) return "—";
  return `${value.slice(0, 7)}…${value.slice(-5)}`;
}

function readyAssets(walletSnapshot) {
  return Array.isArray(walletSnapshot?.assets)
    ? walletSnapshot.assets.filter((asset) => asset?.status === "ready")
    : [];
}

function activityCategory(item) {
  const kind = String(item?.kind || "").toLowerCase();
  const type = String(item?.type || "").toLowerCase();
  if (kind === "swap" || type.includes("swap")) return "swap";
  if (kind.includes("bridge") || type.includes("bridge")) return "bridge";
  if (kind === "received" || type.includes("received")) return "receive";
  return "send";
}

function activityLabel(item) {
  const category = activityCategory(item);
  if (category === "swap") return "Swap";
  if (category === "bridge") return "Bridge";
  if (category === "receive") return "Received";
  return "Sent";
}

function AssetMark({ symbol }) {
  const marks = { USDC: "$", EURC: "€", cirBTC: "₿", ETH: "Ξ" };
  return (
    <span className={`token-mark is-${String(symbol || "token").toLowerCase()}`}>
      {marks[symbol] || String(symbol || "?").slice(0, 1)}
    </span>
  );
}

async function getJson(url, signal) {
  const response = await fetch(url, { signal });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || "Wallet data is temporarily unavailable.");
  return payload;
}

const WalletDashboard = memo(function WalletDashboard({
  walletSnapshot,
  activityItems = [],
  onSelectView,
  onReceive
}) {
  const [addressCopied, setAddressCopied] = useState(false);
  const assets = readyAssets(walletSnapshot);
  const recent = activityItems.slice(0, 5);
  const address = walletSnapshot?.address || "";
  const balancesQuery = useQuery({
    queryKey: ["wallet-balances", address],
    queryFn: ({ signal }) =>
      getJson(`/api/wallet-balances?address=${encodeURIComponent(address)}`, signal),
    enabled: Boolean(address),
    staleTime: 45_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false
  });
  const networkBalances = Array.isArray(balancesQuery.data?.networks)
    ? balancesQuery.data.networks
    : [];
  const fundedAssets = assets.filter((asset) => Number(asset?.balanceValue || 0) > 0);
  const activeChain = walletSnapshot?.activeChain || arcActiveChain;
  const isTestnet = Boolean(activeChain.testnet);
  const supportedNetworkNames = MULTICHAIN_WALLET_CHAINS.map((chain) => chain.name).join(", ");
  const activeBalance =
    walletSnapshot?.usdcBalance ||
    (walletSnapshot?.balanceStatus === "loading" ? "Syncing…" : "0.00 USDC");
  const copyAddress = useCallback(async () => {
    if (!address || !navigator?.clipboard) return;
    try {
      await navigator.clipboard.writeText(address);
      setAddressCopied(true);
      window.setTimeout(() => setAddressCopied(false), 1800);
    } catch {
      setAddressCopied(false);
    }
  }, [address]);

  const actions = [
    {
      id: "send",
      label: "Send",
      icon: "send",
      click: () => onSelectView?.("send")
    },
    {
      id: "receive",
      label: "Receive",
      icon: "receive",
      click: onReceive
    },
    {
      id: "swap",
      label: "Swap",
      icon: "swap",
      click: () => onSelectView?.("swap")
    },
    {
      id: "bridge",
      label: "Bridge",
      icon: "bridge",
      click: () => onSelectView?.("bridge")
    }
  ];

  return (
    <section className="dashboard">
      <header className="page-heading">
        <div>
          <h1>Portfolio</h1>
          <p>Your assets on {walletSnapshot?.activeChainName || "the active network"}</p>
        </div>
        <button
          type="button"
          className="address-button"
          onClick={copyAddress}
          disabled={!address}
          aria-live="polite"
          aria-label={addressCopied ? "Wallet address copied" : "Copy wallet address"}
        >
          <span>{addressCopied ? "Address copied" : "Copy address"}</span>
          <code>{shortAddress(address)}</code>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="8" y="8" width="11" height="11" rx="2" />
            <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
          </svg>
        </button>
      </header>

      {!walletSnapshot?.supportedNetwork ? (
        <div className="alert is-error">
          <strong>Unsupported network</strong>
          <span>Switch to {supportedNetworkNames} from the network selector.</span>
        </div>
      ) : null}

      <section className="balance-hero">
        <div className="balance-copy">
          <span>Total balance</span>
          <strong>{activeBalance}</strong>
          <div className="balance-meta" role="note">
            <span className="environment-status">
              <i aria-hidden="true" />
              {activeChain.name}
            </span>
            <span>
              {isTestnet
                ? "No real-world value"
                : "Assets may have real-world value — verify before signing"}
            </span>
          </div>
        </div>
        <div className="balance-aside" aria-label="Wallet status">
          <span>{fundedAssets.length}</span>
          <div>
            <strong>Funded {fundedAssets.length === 1 ? "asset" : "assets"}</strong>
            <small>Public onchain balance</small>
          </div>
        </div>
      </section>

      <div className="action-grid">
        {actions.map((action) => (
          <button key={action.id} type="button" className="action-card" onClick={action.click}>
            <span className="action-icon">
              <FeatureIcon name={action.icon} />
            </span>
            <strong>{action.label}</strong>
          </button>
        ))}
      </div>

      <section className="network-balance-section" aria-labelledby="network-balances-title">
        <header className="section-heading">
          <div>
            <span className="eyebrow">Across networks</span>
            <h2 id="network-balances-title">Token balances</h2>
          </div>
          <button
            type="button"
            onClick={() => balancesQuery.refetch()}
            disabled={balancesQuery.isFetching}
          >
            Refresh
          </button>
        </header>
        <div className="network-balance-grid" aria-live="polite">
          {networkBalances.length
            ? networkBalances.map((network) => (
                <article
                  key={network.chainId}
                  className={
                    Number(network.chainId) === Number(walletSnapshot?.chainId) ? "is-active" : ""
                  }
                >
                  <div>
                    <span className="network-dot" aria-hidden="true" />
                    <strong>{network.name}</strong>
                  </div>
                  <p>{network.status === "ready" ? network.assetSummary : "Balance unavailable"}</p>
                  <small>
                    {Number(network.chainId) === Number(walletSnapshot?.chainId)
                      ? "Active network"
                      : "Public balance"}
                  </small>
                </article>
              ))
            : MULTICHAIN_WALLET_CHAINS.map((chain) => (
                <article key={chain.id}>
                  <div>
                    <span className="network-dot" />
                    <strong>{chain.name}</strong>
                  </div>
                  <p>{balancesQuery.isError ? "Sync unavailable" : "Syncing…"}</p>
                  <small>{chain.testnet ? "Testnet" : "Mainnet"}</small>
                </article>
              ))}
        </div>
        {balancesQuery.isError ? (
          <p className="inline-error" role="alert">
            {balancesQuery.error.message}
          </p>
        ) : null}
      </section>

      <div className="content-grid">
        <article className="panel assets-panel">
          <header className="section-heading">
            <div>
              <h2>Assets</h2>
            </div>
            <span className="section-context">{walletSnapshot?.activeChainName || "Network"}</span>
          </header>
          <div className="asset-table-head" aria-hidden="true">
            <span>Token</span>
            <span>Balance</span>
            <span>Network</span>
          </div>
          <div className="asset-list">
            {assets.length ? (
              assets.map((asset) => (
                <div className="asset-row" key={`${walletSnapshot?.chainId}-${asset.symbol}`}>
                  <span className="asset-name">
                    <AssetMark symbol={asset.symbol} />
                    <span>
                      <strong>{asset.symbol}</strong>
                      <small>{asset.name}</small>
                    </span>
                  </span>
                  <span className="asset-balance">
                    <strong>{asset.balance || `0 ${asset.symbol}`}</strong>
                    <small>
                      {isTestnet
                        ? asset.native
                          ? "Testnet gas asset"
                          : "Testnet token"
                        : asset.native
                          ? "Mainnet gas asset"
                          : "Mainnet token"}
                    </small>
                  </span>
                  <span className="asset-network">
                    <i aria-hidden="true" />
                    {walletSnapshot?.activeChainName || "Network"}
                  </span>
                </div>
              ))
            ) : (
              <div className="empty-state">
                <strong>
                  {walletSnapshot?.balanceStatus === "loading"
                    ? "Syncing balances…"
                    : "No supported assets found."}
                </strong>
                <span>{walletSnapshot?.balanceError || "Balances update automatically."}</span>
              </div>
            )}
          </div>
        </article>

        <article className="panel activity-preview">
          <header className="section-heading">
            <div>
              <h2>Recent activity</h2>
            </div>
            <button type="button" onClick={() => onSelectView?.("activity")}>
              View all
            </button>
          </header>
          <div className="activity-preview-list">
            {recent.length ? (
              recent.map((item) => {
                const category = activityCategory(item);
                return (
                  <button
                    type="button"
                    key={item.id || item.txHash}
                    onClick={() => onSelectView?.("activity")}
                  >
                    <span className={`mini-icon is-${category}`}>
                      <FeatureIcon name={category === "receive" ? "receive" : category} />
                    </span>
                    <span>
                      <strong>{activityLabel(item)}</strong>
                      <small>{item.summary || item.chain || "Wallet activity"}</small>
                    </span>
                    <span>
                      <strong>{item.amount || "Contract interaction"}</strong>
                      <small>{item.status || item.timeLabel || "Unknown"}</small>
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="empty-state">
                <strong>No activity yet</strong>
                <span>Recent Arc transactions will appear here.</span>
              </div>
            )}
          </div>
        </article>
      </div>

      <button type="button" className="dashboard-copilot" onClick={() => onSelectView?.("agent")}>
        <span className="dashboard-copilot-icon">
          <FeatureIcon name="ai" />
        </span>
        <span>Ask Lumexa about this wallet…</span>
        <kbd aria-hidden="true">↑</kbd>
      </button>
    </section>
  );
});

export default WalletDashboard;
