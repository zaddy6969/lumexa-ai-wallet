import { useQuery } from "@tanstack/react-query";
import { memo } from "react";
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
  const networkQuery = useQuery({
    queryKey: ["arc-status"],
    queryFn: ({ signal }) => getJson("/api/arc-status", signal),
    enabled: Boolean(walletSnapshot?.onArc),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false
  });

  const networkBalances = Array.isArray(balancesQuery.data?.networks)
    ? balancesQuery.data.networks
    : [];
  const fundedAssets = assets.filter((asset) => Number(asset?.balanceValue || 0) > 0);
  const activeBalance =
    walletSnapshot?.usdcBalance ||
    (walletSnapshot?.balanceStatus === "loading" ? "Syncing…" : "0.00 USDC");
  const healthLabel = walletSnapshot?.supportedNetwork
    ? walletSnapshot?.balanceStatus === "error"
      ? "Needs attention"
      : "Connected"
    : "Unsupported";

  const actions = [
    {
      id: "send",
      label: "Send",
      helper: "Transfer USDC",
      icon: "send",
      click: () => onSelectView?.("send")
    },
    {
      id: "receive",
      label: "Receive",
      helper: "Address or request",
      icon: "receive",
      click: onReceive
    },
    {
      id: "swap",
      label: "Swap",
      helper: "Get a live quote",
      icon: "swap",
      click: () => onSelectView?.("swap")
    },
    {
      id: "bridge",
      label: "Bridge",
      helper: "Move across chains",
      icon: "bridge",
      click: () => onSelectView?.("bridge")
    }
  ];

  return (
    <section className="dashboard">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Wallet overview</span>
          <h1>Your wallet</h1>
          <p>
            {shortAddress(address)} · {walletSnapshot?.activeChainName || "Unsupported network"}
          </p>
        </div>
        <div
          className={`connection-status ${walletSnapshot?.supportedNetwork ? "is-online" : "is-error"}`}
        >
          <i aria-hidden="true" />
          <span>
            <strong>{healthLabel}</strong>
            <small>Chain ID {walletSnapshot?.chainId || "—"}</small>
          </span>
        </div>
      </header>

      <div className="testnet-banner" role="note">
        <span aria-hidden="true">i</span>
        <div>
          <strong>Arc Testnet</strong>
          <p>
            All balances and assets shown in Lumexa currently have no real-world monetary value.
          </p>
        </div>
      </div>

      {!walletSnapshot?.supportedNetwork ? (
        <div className="alert is-error">
          <strong>Unsupported network</strong>
          <span>Switch to Arc, Ethereum Sepolia, or Base Sepolia from the network selector.</span>
        </div>
      ) : null}

      <section className="balance-hero">
        <div className="balance-copy">
          <span>Available on active network</span>
          <strong>{activeBalance}</strong>
          <div className="balance-meta">
            <span>
              {fundedAssets.length} funded {fundedAssets.length === 1 ? "asset" : "assets"}
            </span>
            <i />
            <span>Public onchain balance</span>
            <i />
            <span>No fiat valuation on testnet</span>
          </div>
        </div>
        <div className="network-health-card">
          <span className="network-letter">
            {walletSnapshot?.activeChainName?.slice(0, 1) || "?"}
          </span>
          <div>
            <small>Active network</small>
            <strong>{walletSnapshot?.activeChainName || "Unsupported"}</strong>
            <span>
              {walletSnapshot?.nativeSymbol
                ? `Gas: ${walletSnapshot.nativeSymbol}`
                : "Network data unavailable"}
            </span>
          </div>
          {walletSnapshot?.onArc ? (
            <dl>
              <div>
                <dt>Block</dt>
                <dd>
                  {networkQuery.data?.blockNumber
                    ? Number(networkQuery.data.blockNumber).toLocaleString()
                    : "Live"}
                </dd>
              </div>
              <div>
                <dt>RPC</dt>
                <dd>
                  {networkQuery.data?.latencyMs
                    ? `${networkQuery.data.latencyMs} ms`
                    : networkQuery.isError
                      ? "Retrying"
                      : "Ready"}
                </dd>
              </div>
            </dl>
          ) : null}
        </div>
      </section>

      <div className="action-grid">
        {actions.map((action) => (
          <button key={action.id} type="button" className="action-card" onClick={action.click}>
            <span className="action-icon">
              <FeatureIcon name={action.icon} />
            </span>
            <span>
              <strong>{action.label}</strong>
              <small>{action.helper}</small>
            </span>
            <b aria-hidden="true">→</b>
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
            : ["Arc Testnet", "Ethereum Sepolia", "Base Sepolia"].map((name) => (
                <article key={name}>
                  <div>
                    <span className="network-dot" />
                    <strong>{name}</strong>
                  </div>
                  <p>{balancesQuery.isError ? "Sync unavailable" : "Syncing…"}</p>
                  <small>Testnet</small>
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
              <span className="eyebrow">Active network</span>
              <h2>Assets</h2>
            </div>
          </header>
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
                    <small>{asset.native ? "Testnet gas asset" : "Testnet token"}</small>
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
              <span className="eyebrow">Activity</span>
              <h2>Recent transactions</h2>
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
    </section>
  );
});

export default WalletDashboard;
