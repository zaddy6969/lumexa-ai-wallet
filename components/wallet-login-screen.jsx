import Link from "next/link";
import { ThemeToggle } from "./theme-provider";
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

const IS_TESTNET = Boolean(arcActiveChain.testnet);
const FEATURES = [
  { icon: "send", title: "Send", copy: "Review the recipient and fee before signing." },
  { icon: "swap", title: "Swap", copy: "Use live quotes with clear slippage limits." },
  {
    icon: "bridge",
    title: "Bridge",
    copy: `Move USDC across supported ${IS_TESTNET ? "test " : ""}networks.`
  }
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
        <div className="login-topbar-actions">
          <span className="environment-pill">
            <i aria-hidden="true" /> {arcActiveChain.name}
          </span>
          <ThemeToggle />
        </div>
      </header>

      <section className="login-hero">
        <div className="login-copy">
          <span className="eyebrow">YOUR MONEY. YOUR NEXT MOVE.</span>
          <h1>
            A smarter wallet.
            <br />
            <em>Entirely yours.</em>
          </h1>
          <p>
            Send, swap and bridge on Arc. Tell Lumexa what you have in mind, review the details, and
            make your move.
          </p>
          <div className="login-hero-actions">
            <Link className="button button-secondary" href="/assistant">
              Meet your AI assistant <span>↗</span>
            </Link>
            <span>Built on Arc · Powered by USDC</span>
          </div>
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
          <span className="eyebrow">YOUR WALLET STARTS HERE</span>
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
            <span>{IS_TESTNET ? "Testnet" : "Mainnet"}</span>
          </div>
          <div className="testnet-notice" data-environment={IS_TESTNET ? "testnet" : "mainnet"}>
            <strong>{IS_TESTNET ? "Testnet environment" : "Mainnet environment"}</strong>
            <span>
              {IS_TESTNET
                ? "Assets shown here have no real-world monetary value."
                : "Assets may have real-world value. Verify every detail before signing."}
            </span>
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
