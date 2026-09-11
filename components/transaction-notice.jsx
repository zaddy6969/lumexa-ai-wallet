const COPY = {
  send: {
    title: "Review before sending",
    body: "Confirm the full recipient address, amount, and network fee before approving in your wallet."
  },
  swap: {
    title: "Live quote required",
    body: "Lumexa will show the expected output and slippage limit before your wallet asks for approval."
  },
  bridge: {
    title: "Bridge in verified steps",
    body: "Check the source network, Arc destination, fees, and each wallet request before continuing."
  }
};

export default function TransactionNotice({ mode = "send", walletSnapshot }) {
  const copy = COPY[mode] || COPY.send;
  return (
    <div className="transaction-notice" role="note" aria-label={`${copy.title} security notice`}>
      <span className="transaction-notice-icon" aria-hidden="true">
        ✓
      </span>
      <div>
        <strong>{copy.title}</strong>
        <p>{copy.body}</p>
      </div>
      <small>{walletSnapshot?.onArc ? "Arc ready" : "Network check required"}</small>
    </div>
  );
}
