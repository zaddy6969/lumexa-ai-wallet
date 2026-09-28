import { useId, useRef, useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { WALLET_CONNECTION_CHAINS } from "../lib/arc-chain";
import { formatNetworkSwitchError, switchWalletNetwork } from "../lib/wallet-network";

const NETWORK_GROUPS = [
  { label: "Mainnets", testnet: false },
  { label: "Testnets", testnet: true }
];

export default function NetworkSwitcher({ compact = false }) {
  const chainId = useChainId();
  const { connector, isConnected } = useAccount();
  const { switchChainAsync, isPending } = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  const dialog = useRef(null);
  const trigger = useRef(null);
  const switching = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [requestedChainId, setRequestedChainId] = useState(null);
  const currentChain = WALLET_CONNECTION_CHAINS.find((chain) => chain.id === Number(chainId));
  const busy = isPending || requestedChainId !== null;

  function closePanel() {
    dialog.current?.close();
  }

  function openPanel() {
    setError("");
    dialog.current?.showModal();
    setOpen(true);
  }

  async function selectNetwork(chain) {
    if (switching.current || busy) return;
    if (!isConnected) {
      setError("Connect your wallet, then choose a network.");
      return;
    }
    if (chain.id === Number(chainId)) {
      closePanel();
      return;
    }
    switching.current = true;
    setError("");
    setRequestedChainId(chain.id);
    try {
      await switchWalletNetwork({ connector, chain, switchChainAsync });
      closePanel();
    } catch (nextError) {
      setError(formatNetworkSwitchError(nextError));
    } finally {
      switching.current = false;
      setRequestedChainId(null);
    }
  }

  return (
    <div className={`network-switcher ${compact ? "network-switcher-compact" : ""}`}>
      <button
        ref={trigger}
        type="button"
        className="network-trigger"
        aria-label={`Switch network, ${currentChain?.name || "Unsupported network"}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={titleId}
        onClick={openPanel}
        data-testnet={Boolean(currentChain?.testnet)}
      >
        <span className="network-dot" aria-hidden="true" />
        <span>{currentChain?.name || "Unsupported network"}</span>
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="m5 7.5 5 5 5-5" />
        </svg>
      </button>
      <dialog
        ref={dialog}
        id={titleId}
        className="network-picker"
        aria-labelledby={`${titleId}-heading`}
        aria-describedby={descriptionId}
        onClose={() => {
          setOpen(false);
          trigger.current?.focus();
        }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          )
            closePanel();
        }}
      >
        <header className="network-picker-heading">
          <div>
            <span className="eyebrow">YOUR WALLET</span>
            <h2 id={`${titleId}-heading`}>Switch network</h2>
          </div>
          <button
            type="button"
            className="network-picker-close"
            aria-label="Close network selector"
            onClick={closePanel}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="m5 5 10 10M15 5 5 15" />
            </svg>
          </button>
        </header>
        <p id={descriptionId} className="network-picker-description">
          {isConnected
            ? "Choose a network for your connected wallet."
            : "Connect your wallet to switch networks."}
        </p>
        <div className="network-picker-groups" aria-busy={busy}>
          {NETWORK_GROUPS.map((group) => {
            const chains = WALLET_CONNECTION_CHAINS.filter(
              (chain) => Boolean(chain.testnet) === group.testnet
            );
            if (!chains.length) return null;
            return (
              <section className="network-picker-group" key={group.label} aria-label={group.label}>
                <h3>{group.label}</h3>
                {chains.map((chain) => {
                  const selected = isConnected && chain.id === Number(chainId);
                  const pending = requestedChainId === chain.id;
                  return (
                    <button
                      key={chain.id}
                      type="button"
                      className={`network-option ${selected ? "is-selected" : ""}`}
                      data-testnet={Boolean(chain.testnet)}
                      aria-label={`Switch to ${chain.name}`}
                      aria-pressed={selected}
                      disabled={busy}
                      onClick={() => void selectNetwork(chain)}
                    >
                      <span className="network-option-mark" aria-hidden="true">
                        {chain.name.startsWith("Arc")
                          ? "A"
                          : chain.name.startsWith("Base")
                            ? "B"
                            : "Ξ"}
                      </span>
                      <span className="network-option-copy">
                        <strong>{chain.name}</strong>
                        <small>
                          {chain.testnet
                            ? "Test tokens · No real-world value"
                            : `${chain.nativeCurrency.symbol} for network fees`}
                        </small>
                      </span>
                      <span className="network-option-state" aria-hidden="true">
                        {pending ? <span className="loading-spinner" /> : selected ? "✓" : "→"}
                      </span>
                    </button>
                  );
                })}
              </section>
            );
          })}
        </div>
        {busy ? (
          <p className="network-picker-feedback" role="status">
            Approve the network switch in your wallet…
          </p>
        ) : null}
        {error ? (
          <p className="network-picker-feedback is-error" role="alert">
            {error}
          </p>
        ) : null}
        {!isConnected ? (
          <button
            type="button"
            className="button button-primary network-picker-connect"
            disabled={!openConnectModal}
            onClick={() => {
              closePanel();
              openConnectModal?.();
            }}
          >
            Connect wallet
          </button>
        ) : null}
        <p className="network-picker-note">Switching networks does not move your funds.</p>
      </dialog>
      {!open && error ? <small role="alert">{error}</small> : null}
    </div>
  );
}
