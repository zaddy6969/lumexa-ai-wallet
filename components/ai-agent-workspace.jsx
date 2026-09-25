import WalletAssistantV2 from "./wallet-assistant-v2";

export default function AiAgentWorkspace(props) {
  return (
    <section className="lumexa-agent-page">
      <header className="lumexa-agent-page-head">
        <div>
          <span className="eyebrow">YOUR AI WORKSPACE</span>
          <h1>Your wallet. In conversation.</h1>
          <p>Ask, review, confirm. A simpler way to move on Arc.</p>
        </div>
      </header>
      <WalletAssistantV2 {...props} />
    </section>
  );
}
