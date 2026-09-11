import { useMemo, useState } from "react";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import {
  ARC_MAINNET_CHAIN_ID,
  ARC_MAINNET_REQUESTED,
  ARC_PUBLIC_MAINNET_LAUNCH_DATE,
  MULTICHAIN_WALLET_CHAINS
} from "../lib/arc-chain";
import { formatNetworkSwitchError, switchWalletNetwork } from "../lib/wallet-network";

function getChain(chainId) {
  return MULTICHAIN_WALLET_CHAINS.find((chain) => chain.id === Number(chainId)) || null;
}

function formatLaunchDate(value) {
  if (!value) return "Sep 16";
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return "Sep 16";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(
    new Date(Date.UTC(year, month - 1, day))
  );
}

export default function NetworkSwitcher({ compact = false }) {
  const chainId = useChainId();
  const { connector, isConnected } = useAccount();
  const { switchChainAsync, isPending } = useSwitchChain();
  const [error, setError] = useState("");
  const [manualPending, setManualPending] = useState(false);
  const [requestedChainId, setRequestedChainId] = useState(null);
  const currentChain = useMemo(() => getChain(chainId), [chainId]);
  const busy = isPending || manualPending;
  const launchLabel = formatLaunchDate(ARC_PUBLIC_MAINNET_LAUNCH_DATE);

  const handleChange = async (event) => {
    const nextChainId = Number(event.target.value);
    const nextChain = getChain(nextChainId);
    if (!nextChain || nextChainId === Number(chainId) || busy || !isConnected) return;

    setError("");
    setRequestedChainId(nextChainId);
    setManualPending(true);

    try {
      await switchWalletNetwork({ connector, chain: nextChain, switchChainAsync });
      setRequestedChainId(null);
      setError("");
    } catch (nextError) {
      setRequestedChainId(null);
      setError(formatNetworkSwitchError(nextError));
    } finally {
      setManualPending(false);
    }
  };

  const displayValue = requestedChainId || (currentChain ? currentChain.id : "");

  return (
    <div
      className={`network-switcher network-switcher-panel ${compact ? "network-switcher-compact" : ""}`}
    >
      <label>
        <span className="network-dot" aria-hidden="true" />
        <span className="network-mobile-label" aria-hidden="true">
          Arc
        </span>
        <select
          value={displayValue}
          onChange={handleChange}
          disabled={busy || !isConnected}
          aria-label="Switch network"
        >
          {!currentChain && !requestedChainId ? (
            <option value="">Unsupported network</option>
          ) : null}
          {MULTICHAIN_WALLET_CHAINS.map((chain) => (
            <option key={chain.id} value={chain.id}>
              {chain.name}
            </option>
          ))}
          {!ARC_MAINNET_REQUESTED ? (
            <option value={ARC_MAINNET_CHAIN_ID} disabled>
              Arc Mainnet — {launchLabel}
            </option>
          ) : null}
        </select>
      </label>
      {busy ? (
        <small>Switching network…</small>
      ) : error ? (
        <small role="alert">{error}</small>
      ) : null}
    </div>
  );
}
