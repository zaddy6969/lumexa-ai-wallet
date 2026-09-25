import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ARC_NETWORK_MODE, arcActiveChain } from "../lib/arc-chain";
import { confirmationIntent } from "../lib/agent-confirmation.mjs";
import { normalizePreparedWalletAction } from "../lib/wallet-copilot";
import { FeatureIcon } from "./wallet-sidebar";

const SendPanel = dynamic(() => import("./send-panel"));
const SwapPanel = dynamic(() => import("./swap-panel"));
const BridgePanel = dynamic(() => import("./bridge-panel"));
const TRANSACTIONS = new Set(["prepare_send", "prepare_swap", "prepare_bridge"]);
function readSession(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    return JSON.parse(sessionStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function short(value) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "Not connected";
}

export default function WalletAssistantV2({
  walletSnapshot,
  activityItems,
  activityStatus,
  initialPrompt,
  onWalletAction,
  onActivitySaved,
  onActivityUpdated
}) {
  const scope = `lumexa-ai-v4:${ARC_NETWORK_MODE}:${walletSnapshot?.address || "guest"}`;
  const [enabled, setEnabled] = useState(() => readSession(`${scope}:consent`, false) === true);
  const [messages, setMessages] = useState(() => {
    const saved = readSession(`${scope}:thread`, []);
    return Array.isArray(saved)
      ? saved
          .slice(-24)
          .filter((m) => ["user", "assistant"].includes(m?.role) && typeof m.content === "string")
      : [];
  });
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [service, setService] = useState(null);
  const [pending, setPending] = useState(null);
  const [transaction, setTransaction] = useState({});
  const [confirming, setConfirming] = useState(false);
  const lock = useRef(false);
  const controller = useRef(null);
  const request = useRef(null);
  const promptSeen = useRef(null);
  const thread = useRef(null);
  const input = useRef(null);
  const mounted = useRef(true);
  const onAgentState = useCallback((state) => setTransaction(state), []);

  const context = useMemo(
    () => ({
      wallet: {
        connected: Boolean(walletSnapshot?.isSignedIn),
        chainId: walletSnapshot?.chainId,
        network: walletSnapshot?.activeChainName,
        onArc: walletSnapshot?.onArc,
        balanceStatus: walletSnapshot?.balanceStatus
      },
      portfolio: {
        status: walletSnapshot?.balanceStatus,
        assets: (walletSnapshot?.assets || [])
          .slice(0, 8)
          .map((a) => ({ symbol: a.symbol, balance: a.balance, balanceLabel: a.balanceLabel }))
      },
      activity: {
        status: activityStatus,
        items: (activityItems || []).slice(0, 8).map((a) => ({
          type: a.type,
          amount: a.amount,
          status: a.status,
          kind: a.kind,
          timeLabel: a.timeLabel
        }))
      }
    }),
    [walletSnapshot, activityItems, activityStatus]
  );

  useEffect(() => {
    mounted.current = true;
    const abort = new AbortController();
    fetch("/api/ai", { cache: "no-store", signal: abort.signal })
      .then((r) => r.json())
      .then(setService)
      .catch(() => {});
    return () => {
      mounted.current = false;
      abort.abort();
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(`${scope}:thread`, JSON.stringify(messages.slice(-24)));
    } catch {}
  }, [messages, scope]);
  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, pending]);

  function addMessage(role, content, model) {
    setMessages((current) => [...current.slice(-29), { role, content, model }]);
  }
  function changeConsent(value) {
    setEnabled(value);
    try {
      sessionStorage.setItem(`${scope}:consent`, JSON.stringify(value));
    } catch {}
    if (value) input.current?.focus();
  }
  async function confirmTransaction() {
    if (lock.current || confirming) return;
    setError("");
    if (!pending || !controller.current) {
      setError("There is no transaction ready to confirm. Tell me what you want to do first.");
      return;
    }
    lock.current = true;
    setConfirming(true);
    try {
      await controller.current.confirm();
    } catch (e) {
      setError(e?.message || "Unable to confirm this review.");
    } finally {
      lock.current = false;
      if (mounted.current) setConfirming(false);
    }
  }
  function cancelTransaction() {
    if (transaction.busy || confirming) {
      setError(
        "A wallet request is in progress. Reject it in your wallet to stop signing; submitted transactions cannot be cancelled here."
      );
      return;
    }
    setPending(null);
    setTransaction({});
    controller.current = null;
    setError("");
    addMessage("assistant", "Review dismissed. I have not initiated another transaction.");
  }
  async function ask(value) {
    const message = String(value || "").trim();
    if (!message || loading || lock.current || confirming) return;
    const intent = confirmationIntent(message);
    if (intent) {
      setQuestion("");
      addMessage("user", message);
      if (intent === "confirm") await confirmTransaction();
      else cancelTransaction();
      return;
    }
    if (!enabled) {
      setError("Enable AI chat to send your message to the model.");
      return;
    }
    if (transaction.busy) {
      setError("Finish the current wallet request before starting another action.");
      return;
    }
    // Any new instruction invalidates the current review before contacting the model.
    setPending(null);
    setTransaction({});
    controller.current = null;
    lock.current = true;
    setLoading(true);
    setError("");
    setQuestion("");
    addMessage("user", message);
    const abort = new AbortController();
    request.current = abort;
    const timer = setTimeout(() => abort.abort(), 50_000);
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({
          question: message,
          messages: messages.slice(-12),
          context,
          cloudConsent: true
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.answer || payload.mode !== "ai-copilot")
        throw new Error(payload.error || "The AI model is unavailable. Please retry.");
      if (!mounted.current) return;
      addMessage("assistant", payload.answer, payload.model);
      const action = normalizePreparedWalletAction(payload.actions?.[0]);
      if (action && TRANSACTIONS.has(action.tool)) {
        if (!walletSnapshot?.isSignedIn)
          addMessage(
            "assistant",
            "Connect your wallet to prepare this transaction, then ask me again."
          );
        else setPending({ ...action, owner: walletSnapshot.address });
      } else if (action) await onWalletAction?.(action);
      setService((current) => ({ ...current, model: payload.model, verified: true }));
    } catch (e) {
      if (mounted.current)
        setError(
          e.name === "AbortError"
            ? "The model took too long to respond. Please retry. No transaction was initiated."
            : e.message
        );
    } finally {
      clearTimeout(timer);
      request.current = null;
      lock.current = false;
      if (mounted.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (!initialPrompt?.id || promptSeen.current === initialPrompt.id) return;
    promptSeen.current = initialPrompt.id;
    // Leave externally suggested text for the user to send.
    setQuestion(initialPrompt.text || "");
  }, [initialPrompt]);

  const Panel =
    pending?.tool === "prepare_send"
      ? SendPanel
      : pending?.tool === "prepare_swap"
        ? SwapPanel
        : BridgePanel;
  const connected = walletSnapshot?.isSignedIn;
  const busy = loading || confirming || transaction.busy;
  return (
    <section className="agent-studio">
      <aside className="agent-sidebar">
        <div className="agent-identity">
          <span className="agent-symbol">✦</span>
          <div>
            <strong>Lumexa</strong>
            <small>Your wallet assistant</small>
          </div>
        </div>
        <span className={`agent-service ${service?.verified ? "is-online" : ""}`}>
          <i />
          {service?.verified
            ? "AI connected"
            : service?.configured
              ? "AI ready to connect"
              : service
                ? "AI connection required"
                : "Checking AI connection…"}
        </span>
        <div className="agent-context">
          <span>WALLET CONTEXT</span>
          <dl>
            <div>
              <dt>Account</dt>
              <dd>{short(walletSnapshot?.address)}</dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>{walletSnapshot?.activeChainName || arcActiveChain.name}</dd>
            </div>
            <div>
              <dt>Balances</dt>
              <dd>
                {walletSnapshot?.balanceStatus === "ready"
                  ? "Loaded"
                  : connected
                    ? "Syncing"
                    : "Connect wallet"}
              </dd>
            </div>
          </dl>
        </div>
        <div className="agent-capabilities">
          <span>WHAT I CAN HELP WITH</span>
          {[
            { icon: "send", title: "Send & receive", copy: "USDC payments on Arc" },
            { icon: "swap", title: "Swap tokens", copy: "Live quotes and minimum output" },
            { icon: "bridge", title: "Bridge USDC", copy: "Arc, Ethereum and Base" },
            {
              icon: "activity",
              title: "Understand your wallet",
              copy: "Balances and recent activity"
            }
          ].map((item) => (
            <div key={item.title}>
              <FeatureIcon name={item.icon} />
              <p>
                <strong>{item.title}</strong>
                <small>{item.copy}</small>
              </p>
            </div>
          ))}
        </div>
        <div className="agent-ownership">
          <FeatureIcon name="wallet" />
          <strong>You stay in control.</strong>
          <p>Lumexa prepares. You review. Your wallet signs.</p>
        </div>
      </aside>
      <div className="agent-conversation">
        <header className="agent-chat-header">
          <div>
            <span className="eyebrow">LUMEXA AI</span>
            <h2>Let’s make your next move.</h2>
          </div>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() => {
              setMessages([]);
              setPending(null);
              setTransaction({});
              setError("");
            }}
          >
            New chat <span aria-hidden="true">＋</span>
          </button>
        </header>
        {!enabled ? (
          <div className="agent-consent">
            <div>
              <strong>A real conversation, connected to your wallet.</strong>
              <p>
                AI chat sends your messages, recent conversation, balances and activity summary to
                Vercel AI Gateway and its model provider. Addresses you type are included. Never
                share recovery phrases or private keys.
              </p>
            </div>
            <button
              className="button button-primary"
              type="button"
              onClick={() => changeConsent(true)}
            >
              Enable AI chat <span>→</span>
            </button>
          </div>
        ) : (
          <div className="agent-model-line">
            <span>
              {service?.model || "AI model"} <b>·</b> Conversation stays in this browser session
            </span>
            <button type="button" disabled={busy} onClick={() => changeConsent(false)}>
              Turn off AI
            </button>
          </div>
        )}
        <div className="agent-thread" ref={thread} aria-live="polite" aria-busy={loading}>
          {!messages.length ? (
            <div className="agent-empty">
              <span className="agent-empty-icon">✦</span>
              <h3>Your words. Your wallet.</h3>
              <p>
                Ask a question or tell Lumexa what you want to do. Every transaction starts with a
                review.
              </p>
              <div className="agent-prompts">
                {[
                  {
                    icon: "portfolio",
                    title: "Understand my balance",
                    text: "Explain my current balances and what I need for gas on Arc."
                  },
                  {
                    icon: "swap",
                    title: "Make a swap",
                    text: "I want to swap USDC to EURC. Help me prepare it."
                  },
                  {
                    icon: "bridge",
                    title: "Move across networks",
                    text: "Help me bridge USDC from Arc to Base."
                  },
                  { icon: "send", title: "Send a payment", text: "Help me send USDC on Arc." }
                ].map((p) => (
                  <button
                    key={p.title}
                    disabled={!enabled || loading}
                    onClick={() => void ask(p.text)}
                  >
                    <FeatureIcon name={p.icon} />
                    <strong>{p.title}</strong>
                    <span>↗</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {messages.map((message, i) => (
            <article className={`agent-message is-${message.role}`} key={i}>
              <span className="agent-message-avatar">
                {message.role === "assistant" ? "✦" : "Y"}
              </span>
              <div>
                <span className="agent-message-author">
                  {message.role === "assistant" ? "Lumexa" : "You"}
                  {message.model ? <small>AI</small> : null}
                </span>
                <p>{message.content}</p>
              </div>
            </article>
          ))}
          {loading ? (
            <div className="agent-thinking" role="status">
              <span className="loading-spinner" /> Lumexa is thinking and checking its tools…
            </div>
          ) : null}
          {pending && pending.owner === walletSnapshot?.address ? (
            <section className="agent-transaction" aria-label="Prepared transaction">
              <header>
                <div>
                  <span className="eyebrow">TRANSACTION REVIEW</span>
                  <strong>
                    {transaction.busy
                      ? "Working with your wallet…"
                      : transaction.ready
                        ? "Ready for your confirmation"
                        : transaction.status === "success"
                          ? "Transaction complete"
                          : "Review the details below"}
                  </strong>
                </div>
                <button
                  type="button"
                  aria-label="Dismiss transaction review"
                  disabled={transaction.busy || confirming}
                  onClick={cancelTransaction}
                >
                  ×
                </button>
              </header>
              <Panel
                key={pending.id}
                walletSnapshot={walletSnapshot}
                copilotAction={pending}
                agentController={controller}
                onAgentState={onAgentState}
                onActivitySaved={onActivitySaved}
                onActivityUpdated={onActivityUpdated}
              />
              <div className="agent-confirm-footer">
                <p>
                  {transaction.ready
                    ? "Say “yes” in chat to confirm this transaction, or use the button below. Your wallet will ask you to sign."
                    : transaction.status === "success"
                      ? "Completed. Check the receipt above or in Activity."
                      : "A current live review is required before confirmation. Each approval happens in your connected wallet."}
                </p>
                <button
                  className="button button-primary"
                  disabled={!transaction.ready || busy}
                  onClick={() => void ask("yes")}
                >
                  Yes, confirm transaction <span>→</span>
                </button>
              </div>
            </section>
          ) : null}
          {error ? (
            <div className="agent-error" role="alert">
              <strong>Something needs your attention</strong>
              <p>{error}</p>
            </div>
          ) : null}
        </div>
        <form
          className="agent-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
        >
          <label className="sr-only" htmlFor="agent-message">
            Message Lumexa
          </label>
          <div>
            <textarea
              id="agent-message"
              ref={input}
              rows={2}
              maxLength={2000}
              value={question}
              disabled={!enabled || busy}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void ask(question);
                }
              }}
              placeholder={
                pending
                  ? "Type yes to confirm, cancel, or describe a change…"
                  : "Ask Lumexa, or describe your next transaction…"
              }
            />
            <button
              type="submit"
              aria-label="Send message"
              disabled={!enabled || !question.trim() || busy}
            >
              ↑
            </button>
          </div>
          <small>
            <span>✦ {arcActiveChain.name}</span>
            <span>AI can make mistakes. Check every transaction.</span>
          </small>
        </form>
      </div>
    </section>
  );
}
