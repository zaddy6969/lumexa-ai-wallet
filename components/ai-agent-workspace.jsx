import WalletAssistant from "./wallet-assistant";

export default function AiAgentWorkspace({
  walletSnapshot,
  activityItems,
  activityStatus,
  initialPrompt,
  onWalletAction
}) {
  // Real model reasoning is the default whenever the server reports a cloud provider.
  // WalletAssistant still sends only its minimized wallet snapshot and never exposes keys.
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem("lumexa-cloud-ai", "enabled");
    } catch {}
  }

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
