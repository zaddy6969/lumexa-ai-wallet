import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";
import { ARC_USDC_ERC20_ADDRESS, arcTestnet } from "../../lib/arc-chain";
import {
  cleanNote,
  createEip681TokenRequest,
  normalizeDecimal,
  parsePositiveDecimal
} from "../../lib/wallet-validation.mjs";

type ReceiveModalProps = {
  open: boolean;
  onClose: () => void;
  address?: string;
  networkLabel?: string;
};

type FeedbackState = { tone: "success" | "error"; message: string } | null;
type ReceiveMode = "address" | "request";

const RECEIVE_ASSETS = ["USDC", "EURC", "cirBTC"];
const subscribeToClient = () => () => {};

function shortenAddress(address?: string) {
  if (!address) return "";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

async function copyTextToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

export default function ReceiveModal({
  open,
  onClose,
  address = "",
  networkLabel = "Arc Testnet"
}: ReceiveModalProps) {
  const mounted = useSyncExternalStore(
    subscribeToClient,
    () => true,
    () => false
  );
  const [mode, setMode] = useState<ReceiveMode>("address");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [isSharing, setIsSharing] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const hasAddress = Boolean(address);
  const shortAddress = useMemo(() => shortenAddress(address), [address]);
  const parsedAmount = useMemo(() => parsePositiveDecimal(amount, 6), [amount]);
  const amountTooLarge = parsedAmount.valid && parsedAmount.units > 1_000_000_000_000_000n;
  const requestValid = parsedAmount.valid && !amountTooLarge && hasAddress;
  const requestUri = useMemo(
    () =>
      requestValid
        ? createEip681TokenRequest({
            tokenAddress: ARC_USDC_ERC20_ADDRESS,
            chainId: arcTestnet.id,
            recipient: address,
            amount,
            decimals: 6
          })
        : "",
    [address, amount, requestValid]
  );
  const qrValue = mode === "request" ? requestUri : address;
  const canShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function" && Boolean(qrValue);

  const handleClose = useCallback(() => {
    setFeedback(null);
    setIsSharing(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => closeButtonRef.current?.focus(), 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus?.();
    };
  }, [handleClose, open]);

  useEffect(() => {
    if (!feedback) return undefined;
    const timeoutId = window.setTimeout(() => setFeedback(null), 1800);
    return () => window.clearTimeout(timeoutId);
  }, [feedback]);

  const textToShare =
    mode === "request"
      ? `${amount} USDC requested on Arc Testnet${note.trim() ? ` — ${note.trim()}` : ""}\n${requestUri}`
      : `Receive on ${networkLabel}: ${address}`;

  const handleCopy = async () => {
    if (!qrValue) {
      setFeedback({
        tone: "error",
        message:
          mode === "request" ? "Enter a valid request amount." : "Wallet address is still loading."
      });
      return;
    }
    try {
      await copyTextToClipboard(mode === "request" ? textToShare : address);
      setFeedback({
        tone: "success",
        message: mode === "request" ? "Payment request copied." : "Address copied."
      });
    } catch {
      setFeedback({ tone: "error", message: "Unable to copy right now." });
    }
  };

  const handleShare = async () => {
    if (!canShare) return;
    try {
      setIsSharing(true);
      await navigator.share({
        title: mode === "request" ? "Lumexa payment request" : "Lumexa wallet address",
        text: textToShare
      });
      setFeedback({ tone: "success", message: "Shared successfully." });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.toLowerCase().includes("abort")) {
        setFeedback({ tone: "error", message: "Unable to share right now." });
      }
    } finally {
      setIsSharing(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          className="receive-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleClose}
        >
          <motion.section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="receive-title"
            aria-describedby="receive-description"
            className="receive-dialog"
            initial={{ opacity: 0, y: 18, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.985 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="receive-header">
              <div>
                <span className="eyebrow">Get paid</span>
                <h2 id="receive-title">Receive USDC</h2>
                <p id="receive-description">
                  Share your address or create an exact payment request.
                </p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                className="close-button"
                onClick={handleClose}
                aria-label="Close receive dialog"
              >
                ×
              </button>
            </header>

            <div className="receive-tabs" role="tablist" aria-label="Receive options">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "address"}
                className={mode === "address" ? "is-active" : ""}
                onClick={() => setMode("address")}
              >
                Wallet address
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "request"}
                className={mode === "request" ? "is-active" : ""}
                onClick={() => setMode("request")}
              >
                Payment request
              </button>
            </div>

            {mode === "request" ? (
              <div className="request-fields" role="tabpanel">
                <label htmlFor="request-amount">
                  Amount <span>USDC</span>
                </label>
                <div
                  className={`amount-input ${amountTouched && !requestValid ? "has-error" : ""}`}
                >
                  <input
                    id="request-amount"
                    inputMode="decimal"
                    value={amount}
                    onBlur={() => setAmountTouched(true)}
                    onChange={(event) => setAmount(normalizeDecimal(event.target.value, 6))}
                    placeholder="0.00"
                    aria-invalid={amountTouched && !requestValid}
                    aria-describedby="request-amount-help"
                  />
                  <strong>USDC</strong>
                </div>
                <small
                  id="request-amount-help"
                  className={amountTouched && !requestValid ? "field-error" : "field-help"}
                >
                  {amountTouched && !parsedAmount.valid
                    ? parsedAmount.error
                    : amountTooLarge
                      ? "Maximum request is 1 billion USDC."
                      : "Up to 6 decimal places."}
                </small>
                <label htmlFor="request-note">
                  Note <span>Optional</span>
                </label>
                <input
                  id="request-note"
                  className="text-input"
                  value={note}
                  onChange={(event) => setNote(cleanNote(event.target.value, 80))}
                  placeholder="Invoice or payment reference"
                  maxLength={80}
                />
              </div>
            ) : (
              <div
                className="receive-asset-row"
                role="tabpanel"
                aria-label="Supported Arc receive assets"
              >
                {RECEIVE_ASSETS.map((asset) => (
                  <span key={asset}>{asset}</span>
                ))}
              </div>
            )}

            <div className="receive-qr-shell">
              {qrValue ? (
                <QRCodeSVG
                  value={qrValue}
                  size={184}
                  bgColor="#ffffff"
                  fgColor="#151824"
                  level="M"
                  includeMargin
                />
              ) : (
                <div className="qr-placeholder">
                  <strong>{mode === "request" ? "Enter an amount" : "Address unavailable"}</strong>
                  <span>
                    {mode === "request"
                      ? "A payment QR will appear here."
                      : "Reconnect your wallet and try again."}
                  </span>
                </div>
              )}
            </div>

            <div className="receive-summary">
              <span>{mode === "request" ? "Payment request" : networkLabel}</span>
              <strong>
                {mode === "request"
                  ? `${requestValid ? parsedAmount.normalized : "0.00"} USDC`
                  : shortAddress || "Address loading"}
              </strong>
              <small>
                {mode === "request"
                  ? `To ${shortAddress || "connected wallet"} on Arc Testnet`
                  : address || "Wallet address unavailable"}
              </small>
            </div>

            <div className="receive-actions">
              <button
                type="button"
                className="button button-primary"
                onClick={() => void handleCopy()}
                disabled={!qrValue}
              >
                {feedback?.tone === "success"
                  ? "Copied"
                  : mode === "request"
                    ? "Copy request"
                    : "Copy address"}
              </button>
              {canShare ? (
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => void handleShare()}
                  disabled={isSharing}
                >
                  {isSharing ? "Sharing…" : "Share"}
                </button>
              ) : null}
              <a
                className="button button-secondary"
                href="https://faucet.circle.com"
                target="_blank"
                rel="noreferrer"
              >
                Faucet
              </a>
            </div>

            <div className="receive-warning" role="note">
              <strong>Testnet only</strong>
              <p>
                Verify the network before sending. Testnet assets have no real-world monetary value.
              </p>
            </div>
            {feedback ? (
              <div className={`receive-toast is-${feedback.tone}`} role="status" aria-live="polite">
                {feedback.message}
              </div>
            ) : null}
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}
