import LegalPage from "../components/legal-page";

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" description="How Lumexa AI Wallet handles wallet and AI data.">
      <section>
        <h2>What Lumexa reads</h2>
        <p>
          When you connect a wallet, Lumexa reads your public address, supported token balances,
          network, and public transaction activity. This information already exists on public
          blockchains. Lumexa never asks for or receives your seed phrase or private key.
        </p>
      </section>
      <section>
        <h2>Optional AI chat</h2>
        <p>
          AI chat is off until you enable it. Messages, recent conversation, token balances and a
          limited activity summary are then sent to Vercel AI Gateway and its selected model
          provider. Addresses you include in a message are sent so the model can prepare the
          requested recipient. The automatic wallet summary excludes your full wallet address and
          full transaction hashes. Never enter private keys, recovery phrases or other secrets in
          chat.
        </p>
        <p>
          You can turn AI chat off at any time. Model access errors are shown explicitly; the
          assistant does not substitute local scripted answers. AI tools prepare transaction reviews
          only. Signing takes place in your connected wallet after your confirmation.
        </p>
      </section>
      <section>
        <h2>Storage and transactions</h2>
        <p>
          Theme and transaction activity may be stored in your browser. AI consent and conversation
          history are stored for the current browser session, separated by wallet and network. New
          chat clears the current conversation. Blockchain transactions are public and permanent
          after you approve and submit them through your wallet. Lumexa does not store AI
          conversations onchain.
        </p>
      </section>
      <section>
        <h2>Third-party infrastructure</h2>
        <p>
          Lumexa relies on wallet connectors, blockchain RPC providers, Arc explorers, Circle
          tooling, and Vercel hosting. Their services may receive standard network information such
          as IP address and request metadata under their own policies.
        </p>
      </section>
    </LegalPage>
  );
}
