import { BrowserProvider, Contract, formatUnits, parseUnits } from "ethers";
import { useMemo, useState } from "react";
import { isAddress } from "viem";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { ARC_USDC_ERC20_ADDRESS, arcTestnet } from "../lib/arc-chain";
import { createWalletActionRecord } from "../lib/local-activity";

const USDC_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

const ARC_NETWORK_LABEL = arcTestnet.name || "Arc";
const ARC_NETWORK_KEY = arcTestnet.testnet ? "Arc_Testnet" : "Arc_Mainnet";

function normalizeAmount(value) {
  const next = String(value || "").replace(/[^\d.]/g, "");
  const [whole, ...rest] = next.split(".");
  return rest.length ? `${whole}.${rest.join("").slice(0, 6)}` : whole;
}

function shortAddress(address) {
  if (!address) return "";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function parseDisplayedBalance(value) {
  const numeric = Number(String(value || "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatNumber(value, maximumFractionDigits = 6) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits
  }).format(numeric);
}

function formatGasFee(value) {
  return `${formatNumber(formatUnits(value, arcTestnet.nativeCurrency.decimals), 6)} ${
    arcTestnet.nativeCurrency.symbol
  }`;
}

function formatSendError(error, fallback) {
  const message = error instanceof Error ? error.message : "";
  const normalized = message.toLowerCase();

  if (
    normalized.includes("user rejected") ||
    normalized.includes("user denied") ||
    normalized.includes("rejected the request")
  ) {
    return "Transaction rejected in your wallet.";
  }

  if (normalized.includes("insufficient")) {
    return "Not enough USDC for this transfer and the Arc network fee.";
  }

  if (
    normalized.includes("network") ||
    normalized.includes("chain") ||
    normalized.includes("unsupported")
  ) {
    return `Switch your wallet to ${ARC_NETWORK_LABEL} and try again.`;
  }

  return message || fallback;
}

async function getTransferContext(connector, sender, recipient, amount) {
  const injectedProvider = await connector.getProvider();
  if (!injectedProvider) throw new Error("Wallet provider is unavailable.");

  const provider = new BrowserProvider(injectedProvider);
  const signer = await provider.getSigner();
  const contract = new Contract(ARC_USDC_ERC20_ADDRESS, USDC_ABI, signer);
  const decimals = Number(await contract.decimals());
  const parsedAmount = parseUnits(amount, decimals);
  const balance = await contract.balanceOf(sender);

  return { provider, contract, parsedAmount, balance };
}

function initialSendValue(action, field) {
  if (action?.tool !== "prepare_send") return "";
  if (field === "recipient") return String(action?.args?.recipient || "").trim();
  return normalizeAmount(action?.args?.amount || "");
}

export default function SendUsdcPanel({
  walletSnapshot,
  onActivitySaved,
  onActivityUpdated,
  copilotAction
}) {
  const { connector } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync, isPending: isSwitchingChain } = useSwitchChain();
  const [recipient, setRecipient] = useState(() => initialSendValue(copilotAction, "recipient"));
  const [amount, setAmount] = useState(() => initialSendValue(copilotAction, "amount"));
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [estimate, setEstimate] = useState(null);
  const [result, setResult] = useState(null);

  const isSignedIn = Boolean(walletSnapshot?.isSignedIn);
  const recipientValid = Boolean(recipient) && isAddress(recipient);
  const amountValue = Number(amount || 0);
  const amountValid = Number.isFinite(amountValue) && amountValue > 0;
  const availableUsdc = parseDisplayedBalance(walletSnapshot?.usdcBalance);
  const balanceReady = walletSnapshot?.balanceStatus === "ready";
  const amountExceedsBalance = balanceReady && amountValue > availableUsdc + 0.0000001;
  const needsArcSwitch = isSignedIn && chainId !== arcTestnet.id;
  const busy =
    isSwitchingChain || ["switching", "estimating", "sending", "confirming"].includes(status);
  const feeValue = estimate
    ? Number(formatUnits(estimate.fee, arcTestnet.nativeCurrency.decimals))
    : 0;
  const totalDebit = amountValue + feeValue;
  const totalExceedsBalance = Boolean(
    estimate && balanceReady && totalDebit > availableUsdc + 0.0000001
  );
  const safeMax = Math.max(0, availableUsdc - feeValue - 0.000001);

  const explorerUrl = useMemo(
    () =>
      result?.hash && arcTestnet.blockExplorers?.default?.url
        ? `${arcTestnet.blockExplorers.default.url}/tx/${result.hash}`
        : "",
    [result]
  );

  const resetReview = () => {
    setEstimate(null);
    setResult(null);
    setError("");
    setStatus("idle");
  };

  const ensureArcNetwork = async () => {
    if (chainId === arcTestnet.id) return;
    if (!switchChainAsync) throw new Error("Wallet network switching is unavailable.");
    setStatus("switching");
    await switchChainAsync({ chainId: arcTestnet.id });
  };

  const validateTransfer = async () => {
    if (!connector || !isSignedIn) throw new Error("Connect your wallet first.");
    if (!recipientValid) throw new Error("Enter a valid wallet address.");
    if (!amountValid) throw new Error("Enter a valid USDC amount.");

    const context = await getTransferContext(connector, walletSnapshot.address, recipient, amount);

    if (context.balance < context.parsedAmount) {
      throw new Error("Insufficient USDC balance.");
    }

    return context;
  };

  const createEstimate = async () => {
    if (needsArcSwitch) await ensureArcNetwork();
    setStatus("estimating");
    const context = await validateTransfer();
    const gasLimit = await context.contract.transfer.estimateGas(recipient, context.parsedAmount);
    const feeData = await context.provider.getFeeData();
    const gasPrice = feeData.gasPrice || feeData.maxFeePerGas;

    if (!gasPrice) throw new Error("Unable to estimate the Arc network fee.");

    const nextEstimate = {
      gasLimit,
      gasPrice,
      fee: gasLimit * gasPrice
    };
    setEstimate(nextEstimate);
    setStatus("ready");
    return { context, nextEstimate };
  };

  const handleReview = async () => {
    setError("");
    setResult(null);

    try {
      if (amountExceedsBalance) {
        throw new Error(`Available balance: ${formatNumber(availableUsdc)} USDC.`);
      }
      await createEstimate();
    } catch (nextError) {
      setEstimate(null);
      setStatus("error");
      setError(formatSendError(nextError, "Unable to review this transfer."));
    }
  };

  const handleSend = async () => {
    if (!estimate || totalExceedsBalance) return;

    setStatus("sending");
    setError("");
    setResult(null);

    try {
      if (needsArcSwitch) await ensureArcNetwork();
      const { contract, parsedAmount } = await validateTransfer();
      setStatus("sending");
      const transaction = await contract.transfer(recipient, parsedAmount);
      setResult({ hash: transaction.hash });

      onActivitySaved?.(
        createWalletActionRecord({
          walletAddress: walletSnapshot.address,
          type: "Sent USDC",
          kind: "sent",
          amount: `${amount} USDC`,
          chain: ARC_NETWORK_LABEL,
          sender: walletSnapshot.address,
          receiver: recipient,
          recipient,
          status: "Pending",
          txHash: transaction.hash,
          explorerUrl: arcTestnet.blockExplorers?.default?.url
            ? `${arcTestnet.blockExplorers.default.url}/tx/${transaction.hash}`
            : "",
          summary: `Sent ${amount} USDC to ${shortAddress(recipient)} on ${ARC_NETWORK_LABEL}.`,
          metadata: { token: "USDC", network: ARC_NETWORK_KEY }
        })
      );

      setStatus("confirming");
      const receipt = await transaction.wait();
      const confirmed = receipt?.status === 1;
      onActivityUpdated?.(transaction.hash, {
        status: confirmed ? "Confirmed" : "Failed",
        blockNumber: Number(receipt?.blockNumber || 0)
      });
      setStatus(confirmed ? "success" : "error");
      if (!confirmed) setError(`Transaction failed on ${ARC_NETWORK_LABEL}.`);
    } catch (nextError) {
      setStatus("error");
      setError(formatSendError(nextError, "Unable to send USDC."));
    }
  };

  const useMax = () => {
    if (!balanceReady || availableUsdc <= 0) return;
    const next = estimate ? safeMax : availableUsdc;
    setAmount(next.toFixed(6).replace(/0+$/, "").replace(/\.$/, ""));
    resetReview();
  };

  if (!isSignedIn) {
    return (
      <section className="card send-panel">
        <div className="send-panel-head">
          <div>
            <span className="send-eyebrow">Arc Transfer</span>
            <h2>Send USDC</h2>
          </div>
          <span className="send-network-pill">{ARC_NETWORK_LABEL}</span>
        </div>
        <div className="send-empty-state">
          <strong>Connect wallet to send</strong>
          <p>Your connected wallet signs every transfer.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="card send-panel">
      <div className="send-panel-head">
        <div>
          <span className="send-eyebrow">Arc Transfer</span>
          <h2>Send USDC</h2>
          <p>Enter a recipient, review the fee, then confirm in your wallet.</p>
        </div>
        <span className="send-network-pill">{ARC_NETWORK_LABEL}</span>
      </div>

      {copilotAction?.tool === "prepare_send" ? (
        <div className="copilot-prepared-note">
          <strong>Prepared by Lumexa</strong>
          <span>Review every field before signing.</span>
        </div>
      ) : null}

      <div className="send-panel-section">
        <div className="send-section-label">
          <span>1</span>
          <div>
            <strong>Recipient</strong>
            <small>Arc-compatible wallet address</small>
          </div>
        </div>
        <label className={`send-address-field ${recipient && !recipientValid ? "has-error" : ""}`}>
          <input
            value={recipient}
            onChange={(event) => {
              setRecipient(event.target.value.trim());
              resetReview();
            }}
            placeholder="0x..."
            spellCheck="false"
            autoComplete="off"
            aria-label="Recipient wallet address"
          />
          {recipientValid ? <span className="send-valid-mark">✓</span> : null}
        </label>
        {recipient && !recipientValid ? (
          <small className="send-field-error">Enter a valid EVM wallet address.</small>
        ) : null}
      </div>

      <div className="send-panel-section">
        <div className="send-section-label">
          <span>2</span>
          <div>
            <strong>Amount</strong>
            <small>USDC to send</small>
          </div>
        </div>
        <label className="send-amount-field">
          <div>
            <input
              value={amount}
              onChange={(event) => {
                setAmount(normalizeAmount(event.target.value));
                resetReview();
              }}
              inputMode="decimal"
              placeholder="0.00"
              aria-label="USDC amount"
            />
            <strong>USDC</strong>
          </div>
          <span className="send-available-line">
            Available {balanceReady ? `${formatNumber(availableUsdc)} USDC` : "syncing…"}
            {balanceReady && availableUsdc > 0 ? (
              <button type="button" onClick={useMax}>
                MAX
              </button>
            ) : null}
          </span>
        </label>

        <div className="send-route-summary">
          <div>
            <span>From</span>
            <strong>{shortAddress(walletSnapshot.address)}</strong>
          </div>
          <span className="send-route-arrow">→</span>
          <div>
            <span>To</span>
            <strong>{recipientValid ? shortAddress(recipient) : "Recipient"}</strong>
          </div>
          <div className="send-route-network">
            <span>Network</span>
            <strong>{ARC_NETWORK_LABEL}</strong>
          </div>
        </div>
      </div>

      {estimate ? (
        <div className="send-panel-section send-review-section">
          <div className="send-section-label">
            <span>3</span>
            <div>
              <strong>Review transfer</strong>
              <small>Check before wallet approval</small>
            </div>
          </div>
          <div className="send-review-grid">
            <div>
              <span>Send</span>
              <strong>{amount} USDC</strong>
            </div>
            <div>
              <span>Network fee</span>
              <strong>{formatGasFee(estimate.fee)}</strong>
            </div>
            <div>
              <span>Recipient</span>
              <strong>{shortAddress(recipient)}</strong>
            </div>
            <div>
              <span>Network</span>
              <strong>{ARC_NETWORK_LABEL}</strong>
            </div>
          </div>
        </div>
      ) : null}

      {amountExceedsBalance || totalExceedsBalance ? (
        <div className="send-warning" role="alert">
          <span>!</span>
          <div>
            <strong>Not enough USDC</strong>
            <p>
              {totalExceedsBalance
                ? `Transfer plus fee is about ${formatNumber(totalDebit)} USDC. Available: ${formatNumber(availableUsdc)} USDC.`
                : `Available balance: ${formatNumber(availableUsdc)} USDC.`}
            </p>
          </div>
          {balanceReady && availableUsdc > 0 ? (
            <button type="button" onClick={useMax}>
              Use max
            </button>
          ) : null}
        </div>
      ) : null}

      {error && !amountExceedsBalance && !totalExceedsBalance ? (
        <p className="send-error" role="alert">
          {error}
        </p>
      ) : null}

      {result?.hash ? (
        <div className="send-success">
          <strong>{status === "success" ? "USDC sent" : "Transaction submitted"}</strong>
          <span>
            {result.hash.slice(0, 10)}…{result.hash.slice(-6)}
          </span>
          {explorerUrl ? (
            <a href={explorerUrl} target="_blank" rel="noreferrer">
              View transaction
            </a>
          ) : null}
        </div>
      ) : null}

      <div className="send-panel-actions">
        {!estimate ? (
          <button
            type="button"
            className="button button-primary"
            onClick={handleReview}
            disabled={!recipientValid || !amountValid || amountExceedsBalance || busy}
          >
            {status === "switching" || isSwitchingChain
              ? "Switching to Arc…"
              : status === "estimating"
                ? "Getting fee…"
                : needsArcSwitch
                  ? "Switch to Arc & review"
                  : "Review transfer"}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="button button-primary"
              onClick={handleSend}
              disabled={busy || totalExceedsBalance}
            >
              {status === "sending"
                ? "Confirm in wallet…"
                : status === "confirming"
                  ? "Confirming…"
                  : `Send ${amount} USDC`}
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={resetReview}
              disabled={busy}
            >
              Edit
            </button>
          </>
        )}
      </div>

      <div className="send-panel-footnote">
        <span>✓ Self-custodial</span>
        <span>✓ Review before signing</span>
        <span>✓ Explorer receipt</span>
      </div>
    </section>
  );
}
