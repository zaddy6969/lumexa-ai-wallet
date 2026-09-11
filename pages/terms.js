import LegalPage from "../components/legal-page";
import { MULTICHAIN_WALLET_CHAINS, arcActiveChain } from "../lib/arc-chain";

export default function TermsPage() {
  const isTestnet = Boolean(arcActiveChain.testnet);
  const supportedNetworks = MULTICHAIN_WALLET_CHAINS.map((chain) => chain.name).join(", ");
  return (
    <LegalPage
      title="Terms and network notice"
      description="Important terms for using Lumexa AI Wallet."
    >
      <section>
        <h2>{isTestnet ? "Testnet software" : "Mainnet software"}</h2>
        <p>
          Lumexa is configured for {supportedNetworks}.{" "}
          {isTestnet
            ? "Tokens on these test networks have no real-world monetary value."
            : "Assets on these networks may have real-world monetary value."}{" "}
          Features may change or become temporarily unavailable as networks and integrations evolve.
        </p>
      </section>
      <section>
        <h2>You control every transaction</h2>
        <p>
          Lumexa is non-custodial. Your connected wallet holds your keys and presents the final
          approval. You are responsible for checking the address, network, amount, token, fees, and
          contract request before signing.
        </p>
      </section>
      <section>
        <h2>No financial or security advice</h2>
        <p>
          Balance summaries, activity explanations, and AI responses are informational. They are not
          financial, legal, tax, investment, or security advice and do not certify that an address,
          token, contract, or transaction is safe.
        </p>
      </section>
      <section>
        <h2>Availability</h2>
        <p>
          Network, wallet, explorer, and Circle services are operated by third parties. Lumexa
          cannot guarantee uninterrupted availability, quote execution, bridge completion time, or
          recovery from a transaction approved in your wallet.
        </p>
      </section>
    </LegalPage>
  );
}
