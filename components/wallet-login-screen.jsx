import { ConnectButton } from "@rainbow-me/rainbowkit";
import Image from "next/image";
import { useEffect, useState } from "react";
import {
  ARC_MAINNET_REQUESTED,
  ARC_MAINNET_READY,
  arcActiveChain,
  hasWalletConnectProjectId
} from "../lib/arc-chain";
import { FeatureIcon } from "./wallet-sidebar";
import SiteFooter from "./site-footer";

const FEATURES = [
  { icon: "send", title: "Send", copy: "Review the recipient and fee before signing." },
  { icon: "swap", title: "Swap", copy: "Use live quotes with clear slippage limits." },
  { icon: "bridge", title: "Bridge", copy: "Move USDC across supported test networks." }
];

export default function WalletLoginScreen({ providerError = "", providerUnavailable = false }) {
  const [connectError, setConnectError] = useState("");
  const [fallbackReady, setFallbackReady] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setFallbackReady(true), 2500);
    return () => window.clearTimeout(timeoutId);
  }, []);

  const mainnetLocked = ARC_MAINNET_REQUESTED && !ARC_MAINNET_READY;

  return (
    <main className="login-page">
      <header className="login-topbar">
        <div className="login-brand">
          <span>
            <Image
              src="/lumexa-wallet-mark.png"
              alt=""
              width={42}
              height={42}
              priority
              sizes="42px"
            />
          </span>
          <div>
            <strong>Lumexa</strong>
            <small>AI Wallet</small>
          </div>
        </div>
        <span className="environment-pill">
          <i aria-hidden="true" /> {arcActiveChain.name}
        </span>
      </header>

      <section className="login-hero">
        <div className="login-copy">
          <span className="eyebrow">Self-custodial USDC wallet</span>
          <h1>Move USDC with confidence.</h1>
          <p>
            Send, swap, and bridge across Arc and supported networks—with every action reviewed
            before your wallet signs.
          </p>
          <div className="login-feature-grid">
            {FEATURES.map((feature) => (
              <div key={feature.title}>
                <span>
                  <FeatureIcon name={feature.icon} />
                </span>
                <strong>{feature.title}</strong>
                <small>{feature.copy}</small>
              </div>
            ))}
          </div>
        </div>

        <section className="connect-card" aria-labelledby="connect-wallet-heading">
          <div className="connect-card-mark" aria-hidden="true">
            <Image
              src="/lumexa-wallet-mark.png"
              alt=""
              width={68}
              height={68}
              priority
              sizes="68px"
            />
          </div>
          <span className="eyebrow">Secure access</span>
          <h2 id="connect-wallet-heading">
            {mainnetLocked ? "Mainnet setup required" : "Connect your wallet"}
          </h2>
          <p>
            {mainnetLocked
              ? "Mainnet remains locked until the verified production configuration is enabled."
              : "Lumexa reads public wallet data. Your wallet keeps your keys and approves every transaction."}
          </p>

          {providerUnavailable || mainnetLocked ? (
            <button
              type="button"
              className="button button-primary connect-button"
              onClick={() => window.location.reload()}
            >
              Reload wallet
            </button>
          ) : (
            <ConnectButton.Custom>
              {({ mounted, openConnectModal }) => {
                const canOpenWallet =
                  typeof openConnectModal === "function" && (mounted || fallbackReady);
                return (
                  <button
                    type="button"
                    className="button button-primary connect-button"
                    onClick={() => {
                      setConnectError("");
                      if (canOpenWallet) openConnectModal();
                      else
                        setConnectError(
                          providerError ||
                            "Wallet connection is unavailable. Refresh and try again."
                        );
                    }}
                    disabled={!canOpenWallet}
                  >
                    {canOpenWallet ? "Connect wallet" : "Preparing wallet…"}
                    <span aria-hidden="true">→</span>
                  </button>
                );
              }}
            </ConnectButton.Custom>
          )}

          {connectError || (providerUnavailable && providerError) ? (
            <p className="form-error" role="alert">
              {connectError || providerError}
            </p>
          ) : null}

          <div className="connect-meta">
            <span>Non-custodial</span>
            <span>USDC gas</span>
            <span>Testnet</span>
          </div>
          <div className="testnet-notice">
            <strong>Testnet environment</strong>
            <span>Assets shown here have no real-world monetary value.</span>
          </div>
          <small className="wallet-support">
            Browser wallets · Safe{hasWalletConnectProjectId ? " · WalletConnect" : ""}
          </small>
        </section>
      </section>

      <div className="login-security-line">
        <span>✓ Never enter a seed phrase</span>
        <span>✓ Review every wallet prompt</span>
        <span>✓ Verify network and address</span>
      </div>
      <SiteFooter />
    </main>
  );
}
