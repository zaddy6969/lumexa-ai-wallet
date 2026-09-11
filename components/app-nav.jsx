import Image from "next/image";
import Link from "next/link";
import { arcActiveChain } from "../lib/arc-chain";
import NetworkSwitcher from "./network-switcher";

function shortAddress(address) {
  if (!address) return "";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function ThemeIcon({ theme }) {
  return theme === "dark" ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.5 14.4A8.2 8.2 0 0 1 9.6 3.5 8.4 8.4 0 1 0 20.5 14.4Z" />
    </svg>
  );
}

export default function AppNav({
  walletSnapshot,
  theme = "light",
  onToggleTheme,
  onOpenAssistant
}) {
  const isConnected = Boolean(walletSnapshot?.isSignedIn && walletSnapshot?.address);

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="brand" aria-label="Lumexa wallet home">
          <span className="brand-mark">
            <Image
              src="/lumexa-wallet-mark.png"
              alt=""
              width={40}
              height={40}
              sizes="40px"
              priority
            />
          </span>
          <span className="brand-copy">
            <strong>Lumexa</strong>
            <small>AI Wallet</small>
          </span>
        </Link>

        <div className="topbar-controls">
          <span
            className="environment-pill"
            title={
              arcActiveChain.testnet
                ? "Testnet assets have no real-world value"
                : "Mainnet assets may have real-world value"
            }
          >
            <i aria-hidden="true" /> {arcActiveChain.name}
          </span>
          <NetworkSwitcher compact />
          <button
            type="button"
            className="icon-button"
            onClick={onToggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            <ThemeIcon theme={theme} />
          </button>
          <button type="button" className="assistant-button" onClick={onOpenAssistant}>
            <span aria-hidden="true">✦</span>
            <b>Ask Lumexa</b>
          </button>
          {isConnected ? (
            <div className="account-menu">
              <span className="account-avatar" aria-hidden="true">
                <Image src="/lumexa-wallet-mark.png" alt="" width={26} height={26} sizes="26px" />
              </span>
              <span className="account-copy">
                <strong>{shortAddress(walletSnapshot.address)}</strong>
                <small>{walletSnapshot?.activeChainName || "Connected"}</small>
              </span>
              <button
                type="button"
                onClick={walletSnapshot.disconnectWallet}
                title="Disconnect wallet"
                aria-label="Disconnect wallet"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4M14 8l4 4-4 4M9 12h9" />
                </svg>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
