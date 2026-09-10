import { ARC_NETWORK_MODE, arcTestnet } from "./arc-chain";

const NETWORK_LABEL = ARC_NETWORK_MODE === "mainnet" ? "Arc Mainnet" : "Arc Testnet";

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getAssets(context) {
  return Array.isArray(context?.portfolio?.assets) ? context.portfolio.assets : [];
}

function getActivityItems(context) {
  return Array.isArray(context?.activity?.items) ? context.activity.items : [];
}

function getLatestActivity(context) {
  return getActivityItems(context)[0] || null;
}

function detectIntent(question) {
  const prompt = normalizeText(question).toLowerCase();
  if (!prompt) return "general_wallet_help";
  if (/\b(risk|safe|safety|approve|approval|allowance|suspicious)\b/.test(prompt)) {
    return "activity_review";
  }
  if (/\b(bridge|send|receive|transfer|pay|swap)\b/.test(prompt)) return "wallet_action";
  if (/\b(contract|transaction|activity|explain)\b/.test(prompt)) return "activity_explainer";
  if (/\b(balance|portfolio|holding|holdings|asset|assets)\b/.test(prompt)) {
    return "portfolio_snapshot";
  }
  if (/\b(gas|fee|fees|network|chain)\b/.test(prompt)) return "network_help";
  return "wallet_summary";
}

function formatConversation(messages) {
  return (Array.isArray(messages) ? messages : [])
    .slice(-6)
    .map((message) => {
      const content = normalizeText(message?.content).slice(0, 1_000);
      return content ? `${message?.role === "assistant" ? "ASSISTANT" : "USER"}: ${content}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function activitySignals(context) {
  const items = getActivityItems(context);
  return {
    visibleCount: items.length,
    approvals: items.filter((item) => String(item?.kind || "").toLowerCase() === "approval").length,
    outgoing: items.filter((item) => String(item?.kind || "").toLowerCase() === "sent").length,
    failed: items.filter((item) => String(item?.status || "").toLowerCase() === "failed").length
  };
}

function portfolioSummary(context) {
  const wallet = context?.wallet || {};
  const assets = getAssets(context);
  if (!wallet.connected) return "Connect a wallet to load its public balances and recent activity.";
  if (!wallet.onArc) {
    return `Your wallet is connected on ${wallet.network || "another network"}. Switch to ${NETWORK_LABEL} to use Arc actions.`;
  }
  if (["loading", "refreshing"].includes(wallet.balanceStatus)) {
    return "The latest public wallet balances are still syncing.";
  }
  if (wallet.balanceStatus === "error") {
    return "The latest balance read is unavailable. Your wallet remains connected; try refreshing shortly.";
  }
  if (!assets.length)
    return `No supported assets were found in the latest ${NETWORK_LABEL} balance read.`;

  const funded = assets.filter((asset) => Number(asset?.balanceValue ?? asset?.balance ?? 0) > 0);
  const holdings = (funded.length ? funded : assets)
    .slice(0, 3)
    .map((asset) => asset.balanceLabel || asset.balance || `0 ${asset.symbol}`)
    .join(", ");
  return `The latest ${NETWORK_LABEL} snapshot shows ${holdings}. ${ARC_NETWORK_MODE === "testnet" ? "These testnet assets have no real-world monetary value." : "Values come from public onchain reads."}`;
}

function activitySummary(context) {
  const latest = getLatestActivity(context);
  const status = context?.activity?.status;
  if (["loading", "refreshing"].includes(status)) return "Recent activity is still syncing.";
  if (status === "error") return "Recent activity is temporarily unavailable.";
  if (!latest) return "No recent activity was found in the limited public lookback window.";
  return `Latest visible activity: ${latest.type || "Onchain interaction"}${latest.amount ? ` — ${latest.amount}` : ""}, ${latest.timeLabel || "recently"}. Its recorded status is ${latest.status || "unknown"}.`;
}

function reviewSummary(context) {
  const signals = activitySignals(context);
  const parts = [
    `I can summarize only the ${signals.visibleCount} recent item${signals.visibleCount === 1 ? "" : "s"} currently loaded; this is not a security audit or risk score.`
  ];
  if (signals.approvals)
    parts.push(
      `${signals.approvals} approval event${signals.approvals === 1 ? "" : "s"} should be checked against the spender and intended allowance.`
    );
  if (signals.outgoing)
    parts.push(
      `${signals.outgoing} outgoing transfer${signals.outgoing === 1 ? " is" : "s are"} visible in this window.`
    );
  if (signals.failed)
    parts.push(
      `${signals.failed} failed transaction${signals.failed === 1 ? " is" : "s are"} visible.`
    );
  if (!signals.visibleCount)
    parts.push("There is not enough visible activity to assess unusual behavior.");
  return parts.join(" ");
}

function explainActivity(question, context) {
  const items = getActivityItems(context);
  const hash = normalizeText(question)
    .match(/0x[a-fA-F0-9]{64}/)?.[0]
    ?.toLowerCase();
  const target = hash
    ? items.find((item) => String(item?.txHash || "").toLowerCase() === hash)
    : items[0];
  if (!target) return activitySummary(context);
  if (String(target.kind).toLowerCase() === "approval") {
    return `This is an approval event for ${target.amount || "a token allowance"}. Confirm that you recognize the spender and intended amount before interacting again; Lumexa has not audited that contract.`;
  }
  if (target.kind === "sent")
    return `This activity sends ${target.amount || "assets"} from the wallet to ${target.counterparty || "another address"}. Verify the destination in the block explorer before relying on it.`;
  if (target.kind === "received")
    return `This activity records ${target.amount || "assets"} received by the wallet from ${target.counterparty || "another address"}.`;
  if (String(target.kind).includes("bridge"))
    return `This is recorded as a bridge action for ${target.amount || "USDC"}. Cross-chain completion can require separate source and destination transactions.`;
  return `${target.summary || target.type || "This is an onchain interaction."} The recorded status is ${target.status || "unknown"}.`;
}

function networkSummary(context) {
  const wallet = context?.wallet || {};
  if (!wallet.connected)
    return `Connect a wallet to check its active network. ${NETWORK_LABEL} uses ${arcTestnet.nativeCurrency.symbol} for gas.`;
  if (!wallet.onArc)
    return `The connected wallet is not on ${NETWORK_LABEL}. Switch to chain ${arcTestnet.id} to continue.`;
  return `The wallet is connected to ${NETWORK_LABEL} (chain ${arcTestnet.id}), where gas is paid in ${arcTestnet.nativeCurrency.symbol}.`;
}

export function buildWalletInsights(context) {
  const wallet = context?.wallet || {};
  const assets = getAssets(context);
  const latest = getLatestActivity(context);
  const signals = activitySignals(context);
  const insights = [
    {
      id: "wallet-status",
      title: "Connection",
      body: wallet.connected
        ? wallet.onArc
          ? `Connected to ${NETWORK_LABEL}.`
          : `Connected outside ${NETWORK_LABEL}.`
        : "Connect a wallet to load public data.",
      tone: wallet.connected && wallet.onArc ? "good" : "neutral"
    },
    {
      id: "activity-signals",
      title: "Visible activity",
      body: `${signals.visibleCount} recent items, ${signals.outgoing} outgoing transfers, and ${signals.approvals} approvals are loaded. This is not a security assessment.`,
      tone: signals.approvals ? "warning" : "neutral"
    },
    {
      id: "portfolio-holdings",
      title: "Tracked assets",
      body: assets.length
        ? `${assets.length} supported asset${assets.length === 1 ? " is" : "s are"} visible in the current snapshot.`
        : "No supported assets are visible in the current snapshot.",
      tone: "neutral"
    }
  ];
  if (latest) {
    insights.push({
      id: "latest-activity",
      title: "Latest activity",
      body: `${latest.type || "Onchain interaction"}${latest.amount ? ` — ${latest.amount}` : ""}. Status: ${latest.status || "unknown"}.`,
      tone: latest.status === "Failed" || latest.kind === "approval" ? "warning" : "neutral"
    });
  }
  return insights.slice(0, 4);
}

export function buildContextDigest(context) {
  const wallet = context?.wallet || {};
  const portfolio = context?.portfolio || {};
  const activity = context?.activity || {};
  const assets = getAssets(context).slice(0, 6);
  const items = getActivityItems(context).slice(0, 6);
  return {
    wallet: {
      connected: Boolean(wallet.connected),
      onArc: Boolean(wallet.onArc),
      chainId: Number(wallet.chainId) || null,
      network: normalizeText(wallet.network).slice(0, 80),
      balanceStatus: normalizeText(wallet.balanceStatus).slice(0, 32) || "idle"
    },
    portfolio: {
      status: normalizeText(portfolio.status).slice(0, 32) || "idle",
      assetCount: assets.length,
      assets: assets.map((asset) => ({
        symbol: normalizeText(asset.symbol).slice(0, 16),
        balanceLabel: normalizeText(asset.balanceLabel || asset.balance).slice(0, 80),
        testnet: ARC_NETWORK_MODE === "testnet"
      }))
    },
    activity: {
      status: normalizeText(activity.status).slice(0, 32) || "idle",
      count: items.length,
      items: items.map((item) => ({
        type: normalizeText(item.type).slice(0, 60),
        amount: normalizeText(item.amount).slice(0, 80),
        summary: normalizeText(item.summary).slice(0, 160),
        timeLabel: normalizeText(item.timeLabel).slice(0, 40),
        txHashShort: normalizeText(item.txHashShort).slice(0, 30),
        status: normalizeText(item.status).slice(0, 24),
        kind: normalizeText(item.kind).slice(0, 32)
      }))
    },
    insights: buildWalletInsights(context)
  };
}

export function buildAssistantInput(question, messages, context) {
  const intent = detectIntent(question);
  const digest = buildContextDigest(context);
  const conversation = formatConversation(messages);
  return [
    {
      role: "developer",
      content: [
        {
          type: "input_text",
          text: [
            `You are Lumexa Copilot inside a self-custodial wallet on ${NETWORK_LABEL}.`,
            "Use only the supplied wallet snapshot for wallet-specific facts.",
            "Never present an activity summary as a security audit, risk score, or guarantee.",
            "Never invent balances, prices, transaction status, contract behavior, or production support.",
            "A wallet action is prepared for review only; the user must approve and sign it.",
            "Never ask for a seed phrase, private key, password, or signing secret.",
            "Keep answers concise and state when data is missing."
          ].join(" ")
        }
      ]
    },
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: [
            `Intent: ${intent}`,
            `Minimized wallet context: ${JSON.stringify(digest)}`,
            conversation ? `Recent conversation:\n${conversation}` : "Recent conversation: none",
            `User question: ${normalizeText(question).slice(0, 800)}`
          ].join("\n\n")
        }
      ]
    }
  ];
}

export function generateLocalAssistantResponse({ question, context }) {
  const intent = detectIntent(question);
  let answer;
  if (intent === "wallet_action") {
    answer = `Use Send, Receive, Swap, or Bridge to prepare the action. Review the network, destination, amount, quote, and fee before approving it in your wallet. ${ARC_NETWORK_MODE === "testnet" ? "Arc Testnet assets have no real-world monetary value." : "Lumexa never signs on your behalf."}`;
  } else if (intent === "activity_explainer") {
    answer = `${explainActivity(question, context)} ${networkSummary(context)}`;
  } else if (intent === "activity_review") {
    answer = reviewSummary(context);
  } else if (intent === "portfolio_snapshot") {
    answer = portfolioSummary(context);
  } else if (intent === "network_help") {
    answer = networkSummary(context);
  } else {
    answer = `${portfolioSummary(context)} ${activitySummary(context)}`;
  }
  return {
    answer,
    insights: buildWalletInsights(context),
    actions: [],
    notice: "Processed in this browser",
    mode: "local-browser",
    provider: "local"
  };
}
