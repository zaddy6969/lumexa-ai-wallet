import WalletAssistant from "./wallet-assistant";

export default function AiAgentWorkspace({
  walletSnapshot,
  activityItems,
  activityStatus,
  initialPrompt,
  onWalletAction
}) {
  return (
    <section className="lumexa-agent-page">
      <header className="lumexa-agent-page-head">
        <div>
          <span className="lumexa-agent-eyebrow">Lumexa Intelligence</span>
          <h1>Wallet Copilot</h1>
          <p>
            One focused assistant for wallet analysis, transaction explanations, Arc network checks,
            and preparing actions for your approval.
          </p>
        </div>
        <div className="lumexa-agent-trust-strip">
          <span>
            <i />
            Self-custodial
          </span>
          <span>
            <i />
            No signing access
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
