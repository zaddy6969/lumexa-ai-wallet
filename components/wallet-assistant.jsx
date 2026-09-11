import { useEffect, useId, useMemo, useRef, useState } from "react";
import { generateLocalAssistantResponse } from "../lib/wallet-copilot";
import { FeatureIcon } from "./wallet-sidebar";

const STARTER_PROMPTS = [
  {
    label: "Summarize balances",
    prompt: "Summarize the balances currently visible in my wallet.",
    icon: "portfolio"
  },
  {
    label: "Explain latest activity",
    prompt: "Explain my latest visible transaction in plain English.",
    icon: "activity"
  },
  {
    label: "Check activity signals",
    prompt: "Review the recent activity signals I can see. Do not give me a risk score.",
    icon: "ai"
  },
  {
    label: "Explain Arc gas",
    prompt: "Explain how gas works on the active Arc network.",
    icon: "bridge"
  }
];

const QUICK_VIEWS = [
  { view: "send", label: "Send", icon: "send" },
  { view: "swap", label: "Swap", icon: "swap" },
  { view: "bridge", label: "Bridge", icon: "bridge" },
  { view: "activity", label: "Activity", icon: "activity" }
];

function shortValue(value, start = 6, end = 4) {
  const text = String(value || "");
  if (!text) return "—";
  if (text.length <= start + end + 3) return text;
  return `${text.slice(0, start)}…${text.slice(-end)}`;
}

function providerName(provider) {
  if (provider === "openai") return "OpenAI";
  if (provider === "vercel-ai-gateway") return "Vercel AI Gateway";
  return "configured cloud provider";
}

function Message({ role, content }) {
  const assistant = role === "assistant";
  return (
    <article className={`lumexa-ai-message is-${role}`}>
      <div className="lumexa-ai-avatar" aria-hidden="true">
        {assistant ? "✦" : "Y"}
      </div>
      <div className="lumexa-ai-message-body">
        <div className="lumexa-ai-message-meta">
          <strong>{assistant ? "Lumexa" : "You"}</strong>
          {assistant ? <span>Wallet Copilot</span> : null}
        </div>
        <div className="lumexa-ai-message-text">
          {String(content || "")
            .split("\n")
            .map((line, index) =>
              line ? (
                <span key={`${line.slice(0, 24)}-${index}`}>{line}</span>
              ) : (
                <br key={`break-${index}`} />
              )
            )}
        </div>
      </div>
    </article>
  );
}

function actionDetails(action) {
  const args = action?.args || {};
  if (action?.tool === "prepare_send") {
    return {
      icon: "send",
      title: `Send ${args.amount || ""} USDC`.trim(),
      meta: `To ${shortValue(args.recipient, 8, 6)}`,
      cta: "Review send"
    };
  }
  if (action?.tool === "prepare_swap") {
    return {
      icon: "swap",
      title: `${args.tokenIn || "Token"} → ${args.tokenOut || "Token"}`,
      meta: `${args.amount || ""} ${args.tokenIn || ""}`.trim(),
      cta: "Review swap"
    };
  }
  if (action?.tool === "prepare_bridge") {
    return {
      icon: "bridge",
      title: `Bridge ${args.amount || ""} USDC`.trim(),
      meta: `${args.sourceNetwork || "Source"} → ${args.destinationNetwork || "Destination"}`,
      cta: "Review bridge"
    };
  }
  if (action?.tool === "switch_network") {
    return {
      icon: "bridge",
      title: "Switch network",
      meta: args.network || "Select network",
      cta: "Review"
    };
  }
  return {
    icon: "activity",
    title: action?.label || "Open wallet",
    meta: "Prepared for review",
    cta: "Open"
  };
}

function PreparedAction({ action, onOpen }) {
  const detail = actionDetails(action);
  return (
    <button type="button" className="lumexa-ai-action-card" onClick={() => onOpen?.(action)}>
      <span className="lumexa-ai-action-icon">
        <FeatureIcon name={detail.icon} />
      </span>
      <span className="lumexa-ai-action-copy">
        <strong>{detail.title}</strong>
        <small>{detail.meta}</small>
      </span>
      <span className="lumexa-ai-action-cta">
        {detail.cta}
        <b aria-hidden="true">→</b>
      </span>
    </button>
  );
}

export default function WalletAssistant({
  walletSnapshot,
  activityItems,
  activityStatus,
  initialPrompt,
  onWalletAction
}) {
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actions, setActions] = useState([]);
  const [cloudAvailable, setCloudAvailable] = useState(false);
  const [cloudEnabled, setCloudEnabled] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.sessionStorage.getItem("lumexa-cloud-ai") === "enabled";
    } catch {
      return false;
    }
  });
  const [provider, setProvider] = useState(null);
  const [providerChecked, setProviderChecked] = useState(false);
  const externalPromptRef = useRef("");
  const requestRef = useRef(null);
  const requestIdRef = useRef(0);
  const textareaRef = useRef(null);
  const threadRef = useRef(null);
  const quickActionId = useId();

  useEffect(() => () => requestRef.current?.abort(), []);

  useEffect(() => {
    let active = true;
    fetch("/api/ai", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => {
        if (!active) return;
        setCloudAvailable(Boolean(payload?.cloudAvailable));
        setProvider(payload?.provider || null);
        setProviderChecked(true);
      })
      .catch(() => {
        if (!active) return;
        setCloudAvailable(false);
        setProvider(null);
        setProviderChecked(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const input = textareaRef.current;
    if (!input) return;
    input.style.height = "0px";
    input.style.height = `${Math.min(Math.max(input.scrollHeight, 48), 132)}px`;
  }, [question]);

  const context = useMemo(() => {
    const assets = Array.isArray(walletSnapshot?.assets) ? walletSnapshot.assets : [];
    return {
      wallet: {
        address: walletSnapshot?.address || "",
        connected: Boolean(walletSnapshot?.isSignedIn),
        chainId: walletSnapshot?.chainId || null,
        network: walletSnapshot?.activeChainName || "",
        onArc: Boolean(walletSnapshot?.onArc),
        usdcBalance: walletSnapshot?.usdcBalance || "",
        nativeBalance: walletSnapshot?.nativeBalance || "",
        balanceStatus: walletSnapshot?.balanceStatus || "idle"
      },
      portfolio: {
        status: walletSnapshot?.balanceStatus || "idle",
        assets: assets.slice(0, 8).map((asset) => ({
          symbol: asset.symbol,
          balance: asset.balance,
          balanceValue: asset.balanceValue,
          balanceLabel: asset.balanceLabel,
          name: asset.name
        }))
      },
      activity: {
        status: activityStatus || "idle",
        items: Array.isArray(activityItems) ? activityItems.slice(0, 8) : []
      }
    };
  }, [activityItems, activityStatus, walletSnapshot]);

  const cloudContext = useMemo(
    () => ({
      wallet: {
        connected: context.wallet.connected,
        chainId: context.wallet.chainId,
        network: context.wallet.network,
        onArc: context.wallet.onArc,
        balanceStatus: context.wallet.balanceStatus
      },
      portfolio: context.portfolio,
      activity: {
        status: context.activity.status,
        items: context.activity.items.slice(0, 6).map((item) => ({
          type: item.type,
          kind: item.kind,
          amount: item.amount,
          chain: item.chain,
          timeLabel: item.timeLabel,
          txHashShort: item.txHashShort,
          status: item.status,
          summary: item.summary
        }))
      }
    }),
    [context]
  );

  const latestActivity = context.activity.items[0] || null;
  const activityCount = context.activity.items.length;
  const assetCount = context.portfolio.assets.length;
  const useCloud = cloudAvailable && cloudEnabled;

  const setCloudConsent = (enabled) => {
    setCloudEnabled(enabled);
    try {
      if (enabled) window.sessionStorage.setItem("lumexa-cloud-ai", "enabled");
      else window.sessionStorage.removeItem("lumexa-cloud-ai");
    } catch {}
  };

  const askAssistant = async (nextQuestion) => {
    const trimmed = String(nextQuestion || "")
      .trim()
      .slice(0, 800);
    if (!trimmed || loading) return;

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const nextMessages = [...messages.slice(-16), { role: "user", content: trimmed }];
    setMessages(nextMessages);
    setQuestion("");
    setLoading(true);
    setError("");
    setActions([]);
    requestRef.current?.abort();
    requestRef.current = new AbortController();

    try {
      let result;
      if (useCloud) {
        const response = await fetch("/api/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: requestRef.current.signal,
          body: JSON.stringify({
            question: trimmed,
            messages: nextMessages.slice(-8),
            context: cloudContext
          })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.answer) {
          throw new Error(payload?.error || "Cloud response was unavailable.");
        }
        result = payload;
      } else {
        result = generateLocalAssistantResponse({ question: trimmed, context });
      }

      if (requestId !== requestIdRef.current) return;
      setMessages((current) => [
        ...current.slice(-17),
        { role: "assistant", content: result.answer }
      ]);
      setActions(Array.isArray(result.actions) ? result.actions : []);
    } catch (nextError) {
      if (requestId !== requestIdRef.current || nextError?.name === "AbortError") return;
      const fallback = generateLocalAssistantResponse({ question: trimmed, context });
      setMessages((current) => [
        ...current.slice(-17),
        { role: "assistant", content: fallback.answer }
      ]);
      setActions([]);
      setError("Cloud AI was unavailable, so Lumexa answered locally instead.");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (
      !initialPrompt?.id ||
      !initialPrompt?.text ||
      externalPromptRef.current === initialPrompt.id
    )
      return;
    externalPromptRef.current = initialPrompt.id;
    void askAssistant(initialPrompt.text);
    // The prompt id is the explicit trigger; context updates must not resubmit it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt?.id]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, actions]);

  const stopAssistant = () => {
    requestIdRef.current += 1;
    requestRef.current?.abort();
    setLoading(false);
  };

  const clearConversation = () => {
    stopAssistant();
    setMessages([]);
    setQuestion("");
    setActions([]);
    setError("");
  };

  const openView = (view) => {
    onWalletAction?.({
      id: `quick-${view}-${quickActionId}`,
      kind: "wallet-action",
      tool: "open_wallet_view",
      label: `Open ${view}`,
      args: { view }
    });
  };

  const showStarter = messages.length === 0 && !loading;
  const providerLabel = useCloud ? providerName(provider) : "On-device rules";

  return (
    <section className="lumexa-ai-workspace">
      <section className="lumexa-ai-context-panel" aria-label="Wallet context">
        <div className="lumexa-ai-identity">
          <span className="lumexa-ai-logo" aria-hidden="true">
            ✦
          </span>
          <div>
            <strong>Lumexa Copilot</strong>
            <small>Local-first wallet help</small>
          </div>
          <span className="lumexa-ai-live is-ready">
            <i />
            {useCloud ? "Cloud on" : "Local"}
          </span>
        </div>

        <div className="lumexa-ai-context-grid">
          <article>
            <span>Assets</span>
            <strong>{assetCount}</strong>
            <small>supported tokens</small>
          </article>
          <article>
            <span>Network</span>
            <strong>{walletSnapshot?.activeChainName || "Wallet"}</strong>
            <small>Chain {walletSnapshot?.chainId || "—"}</small>
          </article>
          <article>
            <span>Activity</span>
            <strong>{activityCount}</strong>
            <small>{activityStatus === "loading" ? "syncing" : "recent items"}</small>
          </article>
          <article>
            <span>Wallet</span>
            <strong>{shortValue(walletSnapshot?.address)}</strong>
            <small>non-custodial</small>
          </article>
        </div>

        <div className="lumexa-ai-rail-section">
          <div className="lumexa-ai-rail-title">
            <strong>Quick actions</strong>
            <span>No AI needed</span>
          </div>
          <div className="lumexa-ai-quick-grid">
            {QUICK_VIEWS.map((item) => (
              <button key={item.view} type="button" onClick={() => openView(item.view)}>
                <span>
                  <FeatureIcon name={item.icon} />
                </span>
                <strong>{item.label}</strong>
              </button>
            ))}
          </div>
        </div>

        <div className="lumexa-ai-rail-section is-latest">
          <div className="lumexa-ai-rail-title">
            <strong>Latest activity</strong>
            <span>{latestActivity?.timeLabel || "—"}</span>
          </div>
          {latestActivity ? (
            <button
              type="button"
              className="lumexa-ai-latest-card"
              onClick={() =>
                askAssistant("Explain my latest visible transaction in plain English.")
              }
            >
              <span className="lumexa-ai-latest-icon">
                <FeatureIcon name="activity" />
              </span>
              <span>
                <strong>{latestActivity.type || "Transaction"}</strong>
                <small>
                  {latestActivity.amount || latestActivity.txHashShort || "Tracked onchain"}
                </small>
              </span>
              <b aria-hidden="true">→</b>
            </button>
          ) : (
            <div className="lumexa-ai-empty-mini">No recent activity loaded.</div>
          )}
        </div>

        <div className="lumexa-ai-privacy-note">
          <span aria-hidden="true">✓</span>
          <div>
            <strong>Self-custodial</strong>
            <small>Lumexa cannot access keys or sign transactions.</small>
          </div>
        </div>
      </section>

      <div className="lumexa-ai-chat-panel">
        <header className="lumexa-ai-chat-head">
          <div>
            <span className="lumexa-ai-chat-orb" aria-hidden="true">
              ✦
            </span>
            <div>
              <strong>Ask Lumexa</strong>
              <small>{loading ? "Working on your request…" : providerLabel}</small>
            </div>
          </div>
          <div className="lumexa-ai-chat-tools">
            <span className="lumexa-ai-provider-pill is-ready">
              <i />
              {providerLabel}
            </span>
            {messages.length ? (
              <button type="button" onClick={clearConversation}>
                New chat
              </button>
            ) : null}
          </div>
        </header>

        <div className="lumexa-ai-consent-card">
          <div>
            <strong>
              {useCloud
                ? "Cloud AI is enabled for this session"
                : "Wallet analysis stays in this browser"}
            </strong>
            <span>
              {useCloud
                ? `Questions and a minimized snapshot—without your address or full transaction hashes—go to ${providerName(provider)}.`
                : cloudAvailable
                  ? "Turn on cloud AI only when you want broader answers or prepared actions."
                  : providerChecked
                    ? "No cloud provider is configured. Local wallet explanations remain available."
                    : "Checking optional cloud availability…"}
            </span>
          </div>
          {cloudAvailable ? (
            <label className="lumexa-ai-consent-toggle">
              <input
                type="checkbox"
                checked={cloudEnabled}
                onChange={(event) => setCloudConsent(event.target.checked)}
              />
              <span aria-hidden="true" />
              <b>{cloudEnabled ? "Cloud on" : "Cloud off"}</b>
            </label>
          ) : null}
        </div>

        <div className="lumexa-ai-thread" ref={threadRef} aria-live="polite">
          {showStarter ? (
            <div className="lumexa-ai-starter">
              <span className="lumexa-ai-starter-mark" aria-hidden="true">
                ✦
              </span>
              <h3>Understand your wallet</h3>
              <p>
                Start with local explanations. Enable cloud AI only when you choose to share a
                minimized snapshot.
              </p>
              <div className="lumexa-ai-starter-grid">
                {STARTER_PROMPTS.map((item) => (
                  <button key={item.label} type="button" onClick={() => askAssistant(item.prompt)}>
                    <span>
                      <FeatureIcon name={item.icon} />
                    </span>
                    <strong>{item.label}</strong>
                    <small>{item.prompt}</small>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {messages.map((message, index) => (
            <Message
              key={`${message.role}-${index}`}
              role={message.role}
              content={message.content}
            />
          ))}
          {loading ? (
            <article className="lumexa-ai-message is-assistant is-thinking">
              <div className="lumexa-ai-avatar">✦</div>
              <div className="lumexa-ai-message-body">
                <div className="lumexa-ai-message-meta">
                  <strong>Lumexa</strong>
                  <span>Analyzing</span>
                </div>
                <div className="lumexa-ai-thinking">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            </article>
          ) : null}
        </div>

        {actions.length ? (
          <div className="lumexa-ai-prepared-actions">
            <div className="lumexa-ai-prepared-head">
              <strong>Prepared for review</strong>
              <span>Your wallet controls the final signature</span>
            </div>
            <div className="lumexa-ai-action-stack">
              {actions.map((action) => (
                <PreparedAction key={action.id} action={action} onOpen={onWalletAction} />
              ))}
            </div>
          </div>
        ) : null}

        <div className="lumexa-ai-composer-wrap">
          <form
            className="lumexa-ai-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void askAssistant(question);
            }}
          >
            <div className="lumexa-ai-composer-context">
              <span>✦</span>
              <strong>{useCloud ? "Minimized context" : "Local context"}</strong>
              <small>{walletSnapshot?.activeChainName || "Connected wallet"}</small>
            </div>
            <textarea
              ref={textareaRef}
              value={question}
              maxLength={800}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (question.trim() && !loading) void askAssistant(question);
                }
              }}
              placeholder="Ask about balances, activity, gas, or a wallet action…"
              rows={1}
              aria-label="Ask Lumexa"
            />
            {loading ? (
              <button
                type="button"
                className="lumexa-ai-stop"
                aria-label="Stop response"
                onClick={stopAssistant}
              >
                ■
              </button>
            ) : (
              <button
                type="submit"
                className="lumexa-ai-send"
                aria-label="Send message"
                disabled={!question.trim()}
              >
                ↑
              </button>
            )}
          </form>
          <div className="lumexa-ai-composer-foot">
            <span>Enter to send · Shift + Enter for a new line</span>
            <span>Never share seed phrases or private keys.</span>
          </div>
        </div>

        {error ? (
          <div className="lumexa-ai-error" role="status">
            <strong>Using local mode</strong>
            <span>{error}</span>
            <button type="button" onClick={() => setError("")}>
              Dismiss
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
