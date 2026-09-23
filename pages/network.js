import { useEffect, useState } from "react";
import Link from "next/link";
import LegalPage from "../components/legal-page";
import {
  ARC_ACTIVE_NETWORK_CONFIG,
  ARC_USDC_ERC20_ADDRESS,
  arcActiveChain
} from "../lib/arc-chain";

export default function NetworkPage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  async function refresh() {
    setLoading(true);
    try {
      const response = await fetch("/api/arc-status", { signal: AbortSignal.timeout(15000) });
      setStatus(await response.json());
    } catch {
      setStatus({ ok: false, error: "Network status is temporarily unavailable." });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    // Fetch the live external network status after the first render.
    const task = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(task);
  }, []);
  return (
    <LegalPage
      title="Built on Arc"
      description="Verify Lumexa's live Arc connection and explore how the wallet uses USDC and Circle App Kit."
      updated="September 22, 2026"
    >
      <section>
        <h2>{arcActiveChain.name}</h2>
        <p>
          Lumexa is a self-custodial wallet interface for USDC payments, token swaps, and
          cross-chain USDC transfers. Your connected wallet holds your keys and signs every
          transaction.
        </p>
        <div
          className={`transaction-alert ${status && !status.ok ? "is-error" : ""}`}
          role="status"
          aria-live="polite"
        >
          <strong>
            {loading
              ? "Checking Arc…"
              : status?.ok
                ? "Live Arc connection verified"
                : "Arc connection needs attention"}
          </strong>
          <span>
            {status?.ok
              ? `Chain ${status.chainId} · Block ${status.blockNumber?.toLocaleString()} · USDC contract verified`
              : status?.error ||
                "Reading the latest block and USDC contract directly from the configured RPC."}
          </span>
        </div>
        {status?.checkedAt ? (
          <p>
            Checked {new Date(status.checkedAt).toLocaleString()}. This checks network availability;
            transaction completion is verified separately using onchain receipts.
          </p>
        ) : null}
        <button className="button button-secondary" onClick={refresh} disabled={loading}>
          {loading ? "Checking…" : "Check again"}
        </button>
      </section>
      <section>
        <h2>What runs on Arc</h2>
        <ul>
          <li>
            Send and request USDC with a full recipient review, gas reserve, and onchain
            confirmation.
          </li>
          <li>Request live swaps through Circle App Kit with a reviewed minimum output.</li>
          <li>
            Bridge native USDC between Arc, Ethereum, and Base using Circle App Kit and CCTP.
            Availability and fees come from live quotes.
          </li>
          <li>
            Use local wallet assistance to prepare actions in plain language. The assistant cannot
            sign or move funds.
          </li>
        </ul>
        <p>
          Arc uses USDC for gas. Its native balance uses 18 decimals and its ERC-20 interface uses
          6; both represent the same USDC balance. Lumexa counts it once and reserves gas before
          sending.
        </p>
      </section>
      <section>
        <h2>Verify the integration</h2>
        <p>
          Chain ID: <strong>{arcActiveChain.id}</strong>
          <br />
          USDC: <code className="full-address">{ARC_USDC_ERC20_ADDRESS}</code>
        </p>
        <p>
          <a href={ARC_ACTIVE_NETWORK_CONFIG.explorerUrl} target="_blank" rel="noreferrer">
            Arc Explorer ↗
          </a>{" "}
          ·{" "}
          <a href="https://github.com/zaddy6969/lumexa-ai-wallet" target="_blank" rel="noreferrer">
            Public source ↗
          </a>{" "}
          ·{" "}
          <a href="https://docs.arc.io" target="_blank" rel="noreferrer">
            Arc documentation ↗
          </a>
        </p>
        <p>
          Connect a compatible wallet to try the app. You need USDC on Arc for gas and transfers;
          Ethereum and Base use ETH for gas. Every operation requires your wallet approval.
        </p>
        <Link href="/" className="button button-primary">
          Open wallet →
        </Link>
      </section>
    </LegalPage>
  );
}
