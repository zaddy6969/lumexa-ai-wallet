import { useEffect, useRef } from "react";
import WalletAssistant from "./wallet-assistant";

export default function AiAgentWorkspace({
  walletSnapshot,
  activityItems,
  activityStatus,
  initialPrompt,
  onWalletAction
}) {
  const lastAutoActionRef = useRef("");

  // Real model reasoning is the default whenever the server reports a cloud provider.
  // WalletAssistant still sends only its minimized wallet snapshot and never exposes keys.
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem("lumexa-cloud-ai", "enabled");
    } catch {}
  }

  // When the AI produces a validated wallet action, execute the navigation/preparation step
  // immediately instead of making the user click a second "Review" card. The transaction
  // screen still owns live quotes, validation and the connected wallet's final signature.
  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    const executePreparedAction = () => {
      const actionCard = document.querySelector(".lumexa-ai-action-card");
      if (!(actionCard instanceof HTMLButtonElement)) return;

      const fingerprint = `${actionCard.textContent || ""}`.trim();
      if (!fingerprint || fingerprint === lastAutoActionRef.current) return;

      lastAutoActionRef.current = fingerprint;
      actionCard.click();
    };

    const observer = new MutationObserver(executePreparedAction);
    observer.observe(document.body, { childList: true, subtree: true });
    executePreparedAction();

    return () => observer.disconnect();
  }, []);

  return (
    <section className="lumexa-agent-page">
      <header className="lumexa-agent-page-head">
        <div>
          <span className="lumexa-agent-eyebrow">Lumexa Intelligence</span>
          <h1>AI Wallet Agent</h1>
          <p>
            Real AI reasoning for wallet analysis, transaction explanations, Arc network checks,
            and intelligent wallet actions with your wallet controlling the final signature.
          </p>
        </div>
        <div className="lumexa-agent-trust-strip">
          <span>
            <i />
            Real AI
          </span>
          <span>
            <i />
            Self-custodial
          </span>
          <span>
            <i />
            Wallet-aware
          </span>
        </div>
      </header>

      <WalletAssistant
        walletSnapshot={walletSnapshot}
        activityItems={activityItems}
        activityStatus={activityStatus}
        initialPrompt={initialPrompt}
        onWalletAction={onWalletAction}
      />
    </section>
  );
}
