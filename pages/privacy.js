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
        <h2>Model-backed wallet assistance</h2>
        <p>
          When you submit an assistant request, Lumexa sends your question and a minimized wallet
          snapshot to the disclosed AI provider. The connected wallet address, full transaction
          hashes, and signing data are excluded from that model context. An address you explicitly
          type into a command may be sent because it is required to prepare that action.
        </p>
      </section>
      <section>
        <h2>Wallet actions</h2>
        <p>
          The model may select a Send, Swap, Bridge, navigation, repeat, or network-switch tool.
          Lumexa validates every tool result before opening a populated review screen. The model
          cannot access your keys, approve a wallet prompt, or broadcast a transaction by itself.
        </p>
      </section>
      <section>
        <h2>Storage and transactions</h2>
        <p>
          Theme and locally prepared activity may be stored in your browser. Blockchain transactions
          are public and permanent after you approve and submit them through your wallet. Lumexa
          does not store AI conversations onchain.
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
