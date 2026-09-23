import { useEffect, useMemo, useRef, useState } from "react";
import { ARC_NETWORK_MODE } from "../lib/arc-chain";
import { resolveNaturalWalletAgent } from "../lib/natural-wallet-agent";
import {
  generateLocalAssistantResponse,
  normalizePreparedWalletAction
} from "../lib/wallet-copilot";
import { FeatureIcon } from "./wallet-sidebar";

const THREAD_KEY = `lumexa-agent-thread-v3:${ARC_NETWORK_MODE}`;
const LAST_ACTION_KEY = `lumexa-agent-last-action-v3:${ARC_NETWORK_MODE}`;

function readSession(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const value = JSON.parse(window.sessionStorage.getItem(key) || "null");
    if (Array.isArray(fallback) && !Array.isArray(value)) return fallback;
    return value ?? fallback;
  } catch {
    return fallback;
  }
}
function writeSession(key, value) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
function short(value, start = 7, end = 5) {
  const s = String(value || "");
  return s.length > start + end + 3 ? `${s.slice(0, start)}…${s.slice(-end)}` : s || "—";
}
function networkLabel(value) {
  return (
    {
      arc: "Arc",
      "ethereum-sepolia": "Ethereum Sepolia",
      "base-sepolia": "Base Sepolia",
      "ethereum-mainnet": "Ethereum",
      "base-mainnet": "Base"
    }[value] ||
    value ||
    ""
  );
}
function actionCopy(action) {
  const a = action?.args || {};
  if (action?.tool === "prepare_swap")
    return {
      icon: "swap",
      title: `Swap ${a.amount} ${a.tokenIn} → ${a.tokenOut}`,
      meta: `Exact input: ${a.amount} ${a.tokenIn}`
    };
  if (action?.tool === "prepare_bridge")
    return {
      icon: "bridge",
      title: `Bridge ${a.amount} USDC`,
      meta: `${networkLabel(a.sourceNetwork)} → ${networkLabel(a.destinationNetwork)}`
    };
  if (action?.tool === "prepare_send")
    return { icon: "send", title: `Send ${a.amount} USDC`, meta: `To ${short(a.recipient)}` };
  return { icon: "activity", title: action?.label || "Wallet action", meta: "Ready" };
}

function Message({ message }) {
  const assistant = message.role === "assistant";
  return (
    <article className={`lumexa-ai-message is-${message.role}`}>
      <div className="lumexa-ai-avatar" aria-hidden="true">
        {assistant ? "✦" : "Y"}
      </div>
      <div className="lumexa-ai-message-body">
        <div className="lumexa-ai-message-meta">
          <strong>{assistant ? "Lumexa" : "You"}</strong>
          {assistant ? <span>AI Wallet Agent</span> : null}
        </div>
        <div className="lumexa-ai-message-text">
          {String(message.content || "")
            .split("\n")
            .map((line, i) => (line ? <span key={i}>{line}</span> : <br key={i} />))}
        </div>
      </div>
    </article>
  );
}

export default function WalletAssistantV2({
  walletSnapshot,
  activityItems,
  activityStatus,
  initialPrompt,
  onWalletAction
}) {
  const threadKey = `${THREAD_KEY}:${walletSnapshot?.address}`;
  const actionKey = `${LAST_ACTION_KEY}:${walletSnapshot?.address}`;
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [cloudAvailable, setCloudAvailable] = useState(false);
  const requestLock = useRef(false);
  const [messages, setMessages] = useState(() => readSession(threadKey, []));
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastAction, setLastAction] = useState(() => readSession(actionKey, null));
  const [provider, setProvider] = useState("Lumexa Agent");
  const threadRef = useRef(null);
  const promptRef = useRef("");

  const context = useMemo(() => {
    const assets = Array.isArray(walletSnapshot?.assets) ? walletSnapshot.assets : [];
    const items = Array.isArray(activityItems) ? activityItems.slice(0, 8) : [];
    return {
      wallet: {
        connected: Boolean(walletSnapshot?.isSignedIn),
        chainId: walletSnapshot?.chainId || null,
        network: walletSnapshot?.activeChainName || "",
        onArc: Boolean(walletSnapshot?.onArc),
        balanceStatus: walletSnapshot?.balanceStatus || "idle"
      },
      portfolio: {
        status: walletSnapshot?.balanceStatus || "idle",
        assets: assets.slice(0, 8).map((a) => ({
          symbol: a.symbol,
          balance: a.balance,
          balanceValue: a.balanceValue,
          balanceLabel: a.balanceLabel,
          name: a.name
        }))
      },
      activity: {
        status: activityStatus || "idle",
        items: items.map((item) => ({
          type: item.type,
          kind: item.kind,
          amount: item.amount,
          chain: item.chain,
          timeLabel: item.timeLabel,
          txHashShort: item.txHashShort,
          status: item.status,
          summary: item.summary,
          counterparty: item.counterparty,
          recipient: item.recipient,
          metadata: item.metadata
        }))
      },
      lastAction
    };
  }, [activityItems, activityStatus, lastAction, walletSnapshot]);

  useEffect(() => {
    writeSession(threadKey, messages.slice(-30));
  }, [messages, threadKey]);
  useEffect(() => {
    if (lastAction) writeSession(actionKey, lastAction);
  }, [lastAction, actionKey]);
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);
  useEffect(() => {
    fetch("/api/ai", { cache: "no-store" })
      .then((r) => r.json())
      .then((p) => {
        setCloudAvailable(Boolean(p?.cloudAvailable));
        setProvider(p?.model || "Cloud AI");
      })
      .catch(() => {});
  }, []);

  async function ask(input) {
    const trimmed = String(input || "")
      .trim()
      .slice(0, 800);
    if (!trimmed || requestLock.current) return;
    requestLock.current = true;
    const history = messages.slice(-12);
    setMessages((current) => [...current.slice(-28), { role: "user", content: trimmed }]);
    setQuestion("");
    setLoading(true);
    setError("");
    try {
      let payload = resolveNaturalWalletAgent({ question: trimmed, messages: history, context });
      if (!payload && cloudEnabled && cloudAvailable) {
        const response = await fetch("/api/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(30_000),
          body: JSON.stringify({
            question: trimmed,
            messages: history,
            context,
            cloudConsent: true
          })
        });
        payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.answer)
          throw new Error(payload?.error || "Lumexa could not answer that request.");
      }
      payload ||= generateLocalAssistantResponse({ question: trimmed, messages: history, context });
      setMessages((current) => [
        ...current.slice(-29),
        { role: "assistant", content: payload.answer }
      ]);
      const prepared = Array.isArray(payload.actions)
        ? payload.actions.find((a) =>
            [
              "prepare_send",
              "prepare_swap",
              "prepare_bridge",
              "switch_network",
              "open_wallet_view"
            ].includes(a?.tool)
          )
        : null;
      const validated = prepared ? normalizePreparedWalletAction(prepared) : null;
      if (validated) {
        if (["prepare_send", "prepare_swap", "prepare_bridge"].includes(prepared.tool))
          setLastAction(validated);
        window.setTimeout(() => onWalletAction?.(validated), 120);
      }
      setProvider(
        payload?.mode === "ai-copilot"
          ? payload?.notice?.replace("Lumexa Agent · ", "") || provider
          : "Lumexa Agent"
      );
    } catch (e) {
      setError(e?.message || "Lumexa could not complete that request.");
    } finally {
      requestLock.current = false;
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!initialPrompt?.id || !initialPrompt?.text || promptRef.current === initialPrompt.id)
      return;
    promptRef.current = initialPrompt.id;
    void ask(initialPrompt.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt?.id]);

  const clear = () => {
    setMessages([]);
    setLastAction(null);
    setError("");
    try {
      sessionStorage.removeItem(threadKey);
      sessionStorage.removeItem(actionKey);
    } catch {}
  };
  const assets = Array.isArray(walletSnapshot?.assets) ? walletSnapshot.assets.length : 0;
  const latest = Array.isArray(activityItems) ? activityItems[0] : null;

  return (
    <section className="lumexa-ai-workspace">
      <section className="lumexa-ai-context-panel" aria-label="Wallet context">
        <div className="lumexa-ai-identity">
          <span className="lumexa-ai-logo">✦</span>
          <div>
            <strong>Lumexa Agent</strong>
            <small>Natural-language wallet intelligence</small>
          </div>
          <span className="lumexa-ai-live is-ready">
            <i />
            Live
          </span>
        </div>
        <div className="lumexa-ai-context-grid">
          <article>
            <span>Assets</span>
            <strong>{assets}</strong>
            <small>supported</small>
          </article>
          <article>
            <span>Network</span>
            <strong>{walletSnapshot?.activeChainName || "Wallet"}</strong>
            <small>Chain {walletSnapshot?.chainId || "—"}</small>
          </article>
          <article>
            <span>Activity</span>
            <strong>{Array.isArray(activityItems) ? activityItems.length : 0}</strong>
            <small>recent items</small>
          </article>
          <article>
            <span>Wallet</span>
            <strong>{short(walletSnapshot?.address)}</strong>
            <small>self-custodial</small>
          </article>
        </div>
        <div className="lumexa-ai-rail-section">
          <div className="lumexa-ai-rail-title">
            <strong>Try normal English</strong>
            <span>No command syntax</span>
          </div>
          <div className="lumexa-ai-capability-list">
            <article>
              <span>
                <FeatureIcon name="swap" />
              </span>
              <div>
                <strong>“Swap 25 USDC to EURC”</strong>
                <small>Fills exact amount + pair</small>
              </div>
            </article>
            <article>
              <span>
                <FeatureIcon name="bridge" />
              </span>
              <div>
                <strong>“Bridge 20 USDC from Arc to Base”</strong>
                <small>Fills amount + route</small>
              </div>
            </article>
            <article>
              <span>
                <FeatureIcon name="send" />
              </span>
              <div>
                <strong>“Send 5 USDC to 0x…”</strong>
                <small>Fills amount + recipient</small>
              </div>
            </article>
          </div>
        </div>
        {lastAction ? (
          <div className="lumexa-ai-rail-section is-latest">
            <div className="lumexa-ai-rail-title">
              <strong>Agent memory</strong>
              <span>Session</span>
            </div>
            <button
              className="lumexa-ai-latest-card"
              type="button"
              onClick={() => ask("Repeat the same action")}
            >
              <span className="lumexa-ai-latest-icon">
                <FeatureIcon name={actionCopy(lastAction).icon} />
              </span>
              <span>
                <strong>{actionCopy(lastAction).title}</strong>
                <small>Say “repeat” to reuse it</small>
              </span>
              <b>→</b>
            </button>
          </div>
        ) : null}
        {latest ? (
          <div className="lumexa-ai-privacy-note">
            <span>✓</span>
            <div>
              <strong>Latest activity loaded</strong>
              <small>
                {latest.type || "Transaction"} {latest.amount ? `· ${latest.amount}` : ""}
              </small>
            </div>
          </div>
        ) : null}
      </section>

      <div className="lumexa-ai-chat-panel">
        <header className="lumexa-ai-chat-head">
          <div>
            <span className="lumexa-ai-chat-orb">✦</span>
            <div>
              <strong>Ask Lumexa anything</strong>
              <small>
                {loading
                  ? "Understanding your request…"
                  : cloudEnabled && cloudAvailable
                    ? provider
                    : "Local wallet assistant"}
              </small>
            </div>
          </div>
          {messages.length ? (
            <div className="lumexa-ai-chat-tools">
              <button type="button" onClick={clear}>
                New chat
              </button>
            </div>
          ) : null}
        </header>
        <div className="lumexa-ai-consent-card">
          <div className="lumexa-ai-consent-copy">
            <small className="lumexa-ai-mode-label">Local-first wallet assistant</small>
            <strong>Speak normally. Lumexa turns intent into wallet actions.</strong>
            <span>
              Ask what Arc is, learn how Lumexa works, or tell it to send, swap, bridge, change an
              amount, or repeat your last prepared action.
            </span>
            <div className="lumexa-ai-mode-badges">
              <span>Exact values</span>
              <span>Session memory</span>
              <span>Wallet signs</span>
            </div>
            <p>Transaction commands and wallet explanations run in your browser.</p>
            {cloudAvailable ? (
              <label className="lumexa-ai-consent-toggle">
                <input
                  type="checkbox"
                  checked={cloudEnabled}
                  onChange={(event) => setCloudEnabled(event.target.checked)}
                />
                <span>
                  Use {provider} for other questions. Sends your question and a minimized wallet
                  summary.
                </span>
              </label>
            ) : (
              <small>Cloud AI is not configured. Local assistance is available.</small>
            )}
          </div>
        </div>
        <div className="lumexa-ai-thread" ref={threadRef} aria-live="polite">
          {!messages.length && !loading ? (
            <div className="lumexa-ai-starter">
              <span className="lumexa-ai-starter-mark">✦</span>
              <h3>What do you want to do?</h3>
              <p>
                No special commands. Try “What is Arc?”, “Swap fifty USDC to euros”, or “How does
                Lumexa work?”
              </p>
              <div className="lumexa-ai-starter-grid">
                <button onClick={() => ask("What is Arc and why is Lumexa built on it?")}>
                  <span>
                    <FeatureIcon name="portfolio" />
                  </span>
                  <strong>Explain Arc</strong>
                  <small>New-user guide</small>
                </button>
                <button onClick={() => ask("How do I swap using Lumexa?")}>
                  <span>
                    <FeatureIcon name="swap" />
                  </span>
                  <strong>How to swap</strong>
                  <small>Natural language</small>
                </button>
              </div>
            </div>
          ) : null}
          {messages.map((message, index) => (
            <Message key={`${message.role}-${index}`} message={message} />
          ))}
          {loading ? (
            <article className="lumexa-ai-thinking">
              <span className="loading-spinner" />
              <div>
                <strong>Understanding intent</strong>
                <small>Extracting exact amount, asset, route and wallet context…</small>
              </div>
            </article>
          ) : null}
          {error ? <div className="lumexa-ai-error">{error}</div> : null}
        </div>
        <form
          className="lumexa-ai-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
        >
          <div className="lumexa-ai-input-wrap">
            <span className="lumexa-ai-input-context">
              ✦ <b>Natural language</b>
              <small>{walletSnapshot?.activeChainName || "Arc"}</small>
            </span>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void ask(question);
                }
              }}
              placeholder="Ask or tell Lumexa what to do…"
              rows={1}
            />
            <button type="submit" disabled={!question.trim() || loading} aria-label="Send">
              ↑
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
