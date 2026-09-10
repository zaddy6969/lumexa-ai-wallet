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
        <h2>Local-first wallet assistance</h2>
        <p>
          Wallet summaries and common explanations run locally in your browser by default. They do
          not require sending your wallet context to an external AI provider.
        </p>
      </section>
      <section>
        <h2>Optional cloud AI</h2>
        <p>
          Cloud AI is disabled until you explicitly enable it. If enabled, Lumexa sends your
          question and a minimized wallet summary to the disclosed provider. Full wallet addresses,
          full transaction hashes, and signing data are excluded. You can disable cloud AI at any
          time.
        </p>
      </section>
      <section>
        <h2>Storage and transactions</h2>
        <p>
          Theme, consent, and locally prepared activity may be stored in your browser. Blockchain
          transactions are public and permanent after you approve and submit them through your
          wallet. Lumexa does not store AI conversations onchain.
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
