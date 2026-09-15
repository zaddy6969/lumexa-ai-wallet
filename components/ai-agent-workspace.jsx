import WalletAssistantV2 from "./wallet-assistant-v2";

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
          <h1>AI Wallet Agent</h1>
          <p>
            Speak in normal English. Lumexa understands your intent, preserves exact transaction
            values, remembers prepared actions in this session, and fills the wallet flow while
            your connected wallet keeps final signing control.
          </p>
        </div>
        <div className="lumexa-agent-trust-strip">
          <span><i />Natural language</span>
          <span><i />Session memory</span>
          <span><i />Self-custodial</span>
        </div>
      </header>

      <WalletAssistantV2
        walletSnapshot={walletSnapshot}
        activityItems={activityItems}
        activityStatus={activityStatus}
        initialPrompt={initialPrompt}
        onWalletAction={onWalletAction}
      />
    </section>
  );
}
