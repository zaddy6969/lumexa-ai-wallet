import { ARC_NETWORK_MODE, arcTestnet } from "./arc-chain.js";

const NETWORK_LABEL = ARC_NETWORK_MODE === "mainnet" ? "Arc Mainnet" : "Arc Testnet";
const NETWORK_VALUES =
  ARC_NETWORK_MODE === "mainnet"
    ? ["arc", "ethereum-mainnet", "base-mainnet"]
    : ["arc", "ethereum-sepolia", "base-sepolia"];
const TOKEN_VALUES =
  ARC_NETWORK_MODE === "mainnet"
    ? [
        "USDC",
        ...(process.env.NEXT_PUBLIC_ARC_MAINNET_EURC_ADDRESS ? ["EURC"] : []),
        ...(process.env.NEXT_PUBLIC_ARC_MAINNET_CIRBTC_ADDRESS ? ["cirBTC"] : [])
      ]
    : ["USDC", "EURC", "cirBTC"];
const MAINNET_ACTIONS_READY =
  ARC_NETWORK_MODE !== "mainnet" ||
  [
    process.env.NEXT_PUBLIC_ARC_MAINNET_APP_KIT_CHAIN,
    process.env.NEXT_PUBLIC_ARC_MAINNET_APP_KIT_MODULE_KEY,
    process.env.NEXT_PUBLIC_ETHEREUM_MAINNET_APP_KIT_CHAIN,
    process.env.NEXT_PUBLIC_ETHEREUM_MAINNET_APP_KIT_MODULE_KEY,
    process.env.NEXT_PUBLIC_BASE_MAINNET_APP_KIT_CHAIN,
    process.env.NEXT_PUBLIC_BASE_MAINNET_APP_KIT_MODULE_KEY
  ].every(Boolean);
const WALLET_VIEWS = new Set([
  "dashboard",
  "send",
  "receive",
  "swap",
  "bridge",
  "activity",
  "agent"
]);
const ACTION_WORDS = /\b(send|transfer|pay|swap|bridge|receive|request|switch|open)\b/i;
const NUMBER_SOURCE = String.raw`(?:\d[\d,]*(?:\.\d+)?|\.\d+)`;
const NETWORK_SOURCE = String.raw`(?:arc(?:\s+(?:testnet|mainnet))?|ethereum(?:\s+(?:sepolia|mainnet))?|eth|base(?:\s+(?:sepolia|mainnet))?)`;
let actionSequence = 0;

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function redactFullTransactionHashes(value) {
  return normalizeText(value).replace(/0x[a-fA-F0-9]{64}\b/g, "[transaction hash]");
}

function redactContextIdentifiers(value) {
  return redactFullTransactionHashes(value).replace(
    /0x[a-fA-F0-9]{40}\b/g,
    "[wallet address]"
  );
}

function plural(value, singular, pluralForm = `${singular}s`) {
  return `${value} ${value === 1 ? singular : pluralForm}`;
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

function formatConversation(messages) {
  return (Array.isArray(messages) ? messages : [])
    .slice(-8)
    .map((message) => {
      const content = redactFullTransactionHashes(message?.content).slice(0, 1_000);
      return content ? `${message?.role === "assistant" ? "ASSISTANT" : "USER"}: ${content}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function activitySignals(context) {
  const items = getActivityItems(context);
  const kindOf = (item) => normalizeText(item?.kind).toLowerCase();
  const statusOf = (item) => normalizeText(item?.status).toLowerCase();
  return {
    visibleCount: items.length,
    approvals: items.filter((item) => kindOf(item) === "approval").length,
    outgoing: items.filter((item) => kindOf(item) === "sent").length,
    received: items.filter((item) => kindOf(item) === "received").length,
    pending: items.filter((item) => ["pending", "submitted"].includes(statusOf(item))).length,
    failed: items.filter((item) => statusOf(item) === "failed").length
  };
}

function normalizeDecimal(value, maximumDecimals = 8) {
  const raw = normalizeText(value).replace(/,/g, "");
  if (!raw || raw.length > 48 || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) return "";
  const [wholeRaw, decimalRaw = ""] = raw.split(".");
  if (decimalRaw.length > maximumDecimals) return "";
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
  const decimal = decimalRaw.replace(/0+$/, "");
  return decimal ? `${whole}.${decimal}` : whole;
}

function amountDetails(text, maximumDecimals) {
  const prompt = normalizeText(text);
  if (!prompt) return { amount: "", found: false, tooPrecise: false };

  const candidates = [];
  const patterns = [
    new RegExp(`(${NUMBER_SOURCE})\\s*(?:usdc|eurc|cir\\s*btc)\\b`, "gi"),
    new RegExp(
      `\\b(?:send|transfer|pay|swap|bridge)\\s+(?:about\\s+|exactly\\s+)?(${NUMBER_SOURCE})`,
      "gi"
    ),
    new RegExp(`\\bamount(?:\\s+is|\\s+of|\\s*[:=])?\\s*(${NUMBER_SOURCE})`, "gi")
  ];

  for (const pattern of patterns) {
    for (const match of prompt.matchAll(pattern)) {
      candidates.push({ index: match.index || 0, raw: match[1] });
    }
  }

  if (new RegExp(`^\\s*${NUMBER_SOURCE}\\s*$`, "i").test(prompt)) {
    candidates.push({ index: prompt.length, raw: prompt });
  }

  if (!candidates.length) return { amount: "", found: false, tooPrecise: false };
  candidates.sort((left, right) => left.index - right.index);
  const raw = normalizeText(candidates[candidates.length - 1].raw).replace(/,/g, "");
  const decimals = raw.includes(".") ? raw.split(".")[1].length : 0;
  return {
    amount: normalizeDecimal(raw, maximumDecimals),
    found: true,
    tooPrecise: decimals > maximumDecimals
  };
}

function actionAmount(question, actionPrompt, maximumDecimals) {
  const current = amountDetails(question, maximumDecimals);
  return current.found ? current : amountDetails(actionPrompt, maximumDecimals);
}

function normalizeToken(value) {
  const token = normalizeText(value).replace(/\s+/g, "").toLowerCase();
  if (token === "usdc") return "USDC";
  if (token === "eurc") return "EURC";
  if (token === "cirbtc") return "cirBTC";
  return "";
}

function tokenMentions(text) {
  const matches = [];
  const pattern = /\b(usdc|eurc|cir\s*btc)\b/gi;
  for (const match of normalizeText(text).matchAll(pattern)) {
    const token = normalizeToken(match[1]);
    if (token) matches.push({ index: match.index || 0, token });
  }
  return matches.sort((left, right) => left.index - right.index).map((item) => item.token);
}

function normalizeNetwork(value) {
  const network = normalizeText(value).toLowerCase().replace(/\s+/g, " ");
  if (!network) return "";
  if (ARC_NETWORK_MODE === "testnet" && network.includes("mainnet")) return "";
  if (
    ARC_NETWORK_MODE === "mainnet" &&
    (network.includes("testnet") || network.includes("sepolia"))
  ) {
    return "";
  }
  if (network.startsWith("arc")) return "arc";
  if (network.startsWith("eth")) {
    return ARC_NETWORK_MODE === "mainnet" ? "ethereum-mainnet" : "ethereum-sepolia";
  }
  if (network.startsWith("base")) {
    return ARC_NETWORK_MODE === "mainnet" ? "base-mainnet" : "base-sepolia";
  }
  return "";
}

function networkMentions(text) {
  const matches = [];
  const pattern = new RegExp(`\\b(${NETWORK_SOURCE})\\b`, "gi");
  for (const match of normalizeText(text).matchAll(pattern)) {
    const network = normalizeNetwork(match[1]);
    if (network) matches.push({ index: match.index || 0, network });
  }
  return matches.sort((left, right) => left.index - right.index).map((item) => item.network);
}

function networkAfterCue(text, cueSource) {
  const match = normalizeText(text).match(new RegExp(`\\b${cueSource}\\s+(${NETWORK_SOURCE})\\b`, "i"));
  return normalizeNetwork(match?.[1]);
}

function mentionsWrongEnvironment(text) {
  const prompt = normalizeText(text).toLowerCase();
  return ARC_NETWORK_MODE === "testnet"
    ? /\bmainnet\b/.test(prompt)
    : /\b(testnet|sepolia)\b/.test(prompt);
}

function walletNetwork(context) {
  const wallet = context?.wallet || {};
  if (wallet.onArc || Number(wallet.chainId) === Number(arcTestnet.id)) return "arc";
  const chainId = Number(wallet.chainId);
  if (ARC_NETWORK_MODE === "mainnet") {
    if (chainId === 1) return "ethereum-mainnet";
    if (chainId === 8453) return "base-mainnet";
  } else {
    if (chainId === 11155111) return "ethereum-sepolia";
    if (chainId === 84532) return "base-sepolia";
  }
  return normalizeNetwork(wallet.network);
}

function shortAddress(value) {
  const address = normalizeText(value);
  return address.length > 16 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address;
}

function extractAddress(text) {
  const matches = normalizeText(text).match(/0x[a-fA-F0-9]{40}\b/g);
  return matches?.length ? matches[matches.length - 1].toLowerCase() : "";
}

function hasAddressLike(text) {
  return /\b0x[a-fA-F0-9]{1,64}\b/.test(normalizeText(text));
}

function createActionId(tool) {
  actionSequence += 1;
  return `local-${tool}-${Date.now()}-${actionSequence}`;
}

function safeActionId(action, tool) {
  const existing = normalizeText(action?.id)
    .replace(/[^a-zA-Z0-9:_-]/g, "")
    .slice(0, 120);
  return existing || createActionId(tool);
}

export function normalizePreparedWalletAction(action) {
  const tool = normalizeText(action?.tool);
  const args = action?.args && typeof action.args === "object" ? action.args : {};
  const id = safeActionId(action, tool || "action");

  if (tool === "prepare_send") {
    const recipient = extractAddress(args.recipient);
    const amount = normalizeDecimal(args.amount, 6);
    if (!recipient || !amount) return null;
    return {
      id,
      kind: "wallet-action",
      tool,
      label: `Review send ${amount} USDC`,
      args: { recipient, amount }
    };
  }

  if (tool === "prepare_swap") {
    if (!MAINNET_ACTIONS_READY || TOKEN_VALUES.length < 2) return null;
    const tokenIn = normalizeToken(args.tokenIn);
    const tokenOut = normalizeToken(args.tokenOut);
    const amount = normalizeDecimal(args.amount, 8);
    const slippageBps = Number(args.slippageBps || 100);
    if (
      !TOKEN_VALUES.includes(tokenIn) ||
      !TOKEN_VALUES.includes(tokenOut) ||
      tokenIn === tokenOut ||
      !amount ||
      ![50, 100, 300].includes(slippageBps)
    ) {
      return null;
    }
    return {
      id,
      kind: "wallet-action",
      tool,
      label: `Review ${tokenIn} → ${tokenOut} swap`,
      args: { tokenIn, tokenOut, amount, slippageBps }
    };
  }

  if (tool === "prepare_bridge") {
    if (!MAINNET_ACTIONS_READY) return null;
    const sourceNetwork = normalizeNetwork(args.sourceNetwork);
    const destinationNetwork = normalizeNetwork(args.destinationNetwork);
    const amount = normalizeDecimal(args.amount, 6);
    if (
      !NETWORK_VALUES.includes(sourceNetwork) ||
      !NETWORK_VALUES.includes(destinationNetwork) ||
      sourceNetwork === destinationNetwork ||
      !amount
    ) {
      return null;
    }
    return {
      id,
      kind: "wallet-action",
      tool,
      label: `Review ${amount} USDC bridge`,
      args: { sourceNetwork, destinationNetwork, amount }
    };
  }

  if (tool === "switch_network") {
    const network = normalizeNetwork(args.network);
    if (!NETWORK_VALUES.includes(network)) return null;
    return {
      id,
      kind: "wallet-action",
      tool,
      label: `Switch to ${network}`,
      args: { network }
    };
  }

  if (tool === "open_wallet_view") {
    const view = normalizeText(args.view).toLowerCase();
    if (!WALLET_VIEWS.has(view)) return null;
    return {
      id,
      kind: "wallet-action",
      tool,
      label: `Open ${view}`,
      args: { view }
    };
  }

  return null;
}

function openViewAction(view) {
  return normalizePreparedWalletAction({
    tool: "open_wallet_view",
    args: { view }
  });
}

function actionResult(answer, action) {
  return {
    answer,
    actions: action ? [action] : []
  };
}

function environmentNote() {
  return ARC_NETWORK_MODE === "testnet"
    ? "Arc Testnet assets have no real-world monetary value."
    : "Your wallet still controls every signature.";
}

function slippageDetails(text) {
  const prompt = normalizeText(text);
  const bpsMatch = prompt.match(/\b(\d{1,4})\s*(?:bps|basis points?)\b/i);
  const percentMatch = prompt.match(/\b(\d+(?:\.\d+)?)\s*%/);
  if (!bpsMatch && !percentMatch) return { value: 100, unsupported: false };
  const value = bpsMatch ? Number(bpsMatch[1]) : Math.round(Number(percentMatch[1]) * 100);
  return { value, unsupported: ![50, 100, 300].includes(value) };
}

function previousActionPrompt(question, messages) {
  const current = normalizeText(question);
  const userTurns = (Array.isArray(messages) ? messages : [])
    .filter((message) => message?.role === "user")
    .map((message) => normalizeText(message?.content))
    .filter(Boolean);

  if (userTurns[userTurns.length - 1] === current) userTurns.pop();
  if (ACTION_WORDS.test(current)) return current;

  const followUp =
    /^(?:0x[a-fA-F0-9]+|[\d.,]+\s*(?:usdc|eurc|cir\s*btc)?|to\b|from\b|recipient\b|amount\b|use\b|make\b|instead\b|arc\b|ethereum\b|eth\b|base\b)/i.test(
      current
    );
  if (!followUp) return current;

  let start = -1;
  for (let index = userTurns.length - 1; index >= 0; index -= 1) {
    if (ACTION_WORDS.test(userTurns[index])) {
      start = index;
      break;
    }
  }
  return start >= 0 ? [...userTurns.slice(start), current].join(" ") : current;
}

function educationalAction(prompt) {
  return /^(?:how|what|why|where|when|is|are|should|explain|tell me about|help me understand)\b/i.test(
    normalizeText(prompt)
  );
}

function walletEducation(prompt) {
  const lower = normalizeText(prompt).toLowerCase();
  if (/\bbridge\b/.test(lower)) {
    return actionResult(
      `Bridge moves USDC between supported networks. Choose different source and destination networks, enter an amount, review the live Circle route and fees, then approve each required wallet signature. ${environmentNote()}`,
      openViewAction("bridge")
    );
  }
  if (/\bswap\b/.test(lower)) {
    return actionResult(
      `Swap converts one supported Arc asset into another. Choose the pair and amount, review the live quote, minimum received and slippage, then sign in your wallet. Lumexa never executes it automatically. ${environmentNote()}`,
      openViewAction("swap")
    );
  }
  if (/\b(receive|request)\b/.test(lower)) {
    return actionResult(
      `Open Receive to show the connected wallet address and QR code. Confirm the sender uses the same network before funds are sent.`,
      openViewAction("receive")
    );
  }
  if (/\b(send|transfer|pay)\b/.test(lower)) {
    return actionResult(
      `Send prepares an Arc USDC transfer. Enter a full recipient address and amount, then verify the network, destination, balance and estimated fee before signing. ${environmentNote()}`,
      openViewAction("send")
    );
  }
  return null;
}

function sendRequest(question, actionPrompt, context) {
  const tokens = tokenMentions(actionPrompt);
  const requestedToken = tokens[tokens.length - 1] || "USDC";
  if (requestedToken !== "USDC") {
    return actionResult(
      `Lumexa Send currently supports USDC only. Use Swap first if you need to convert ${requestedToken}, then review the transfer in Send.`,
      openViewAction("send")
    );
  }

  const amount = actionAmount(question, actionPrompt, 6);
  const recipient = extractAddress(actionPrompt);
  if (hasAddressLike(actionPrompt) && !recipient) {
    return actionResult(
      "That recipient is incomplete. Send the full 42-character EVM address beginning with 0x. Never paste a private key or seed phrase.",
      openViewAction("send")
    );
  }
  if (amount.tooPrecise) {
    return actionResult(
      "USDC transfers support up to 6 decimal places. What amount should I use?",
      openViewAction("send")
    );
  }
  if (!amount.amount) {
    return actionResult(
      "How much USDC should I prepare to send?",
      openViewAction("send")
    );
  }
  if (!recipient) {
    return actionResult(
      `What full 0x recipient address should receive ${amount.amount} USDC?`,
      openViewAction("send")
    );
  }

  const action = normalizePreparedWalletAction({
    tool: "prepare_send",
    args: { recipient, amount: amount.amount }
  });
  const usdc = getAssets(context).find((asset) => normalizeToken(asset?.symbol) === "USDC");
  const visibleBalance = Number(usdc?.balanceValue ?? usdc?.balance);
  const balanceNote =
    Number.isFinite(visibleBalance) && visibleBalance < Number(amount.amount)
      ? " The visible USDC balance may be insufficient; the Send screen will verify it."
      : "";
  return actionResult(
    `I prepared a ${amount.amount} USDC transfer to ${shortAddress(recipient)} on ${NETWORK_LABEL}.${balanceNote} Review the full address, amount and live fee before signing. ${environmentNote()}`,
    action
  );
}

function swapRequest(question, actionPrompt) {
  if (!MAINNET_ACTIONS_READY || TOKEN_VALUES.length < 2) {
    return actionResult(
      `Swap is not configured for ${NETWORK_LABEL} yet. I will not invent a route or quote.`,
      openViewAction("swap")
    );
  }

  const uniqueTokens = [];
  for (const token of tokenMentions(actionPrompt)) {
    if (!uniqueTokens.includes(token)) uniqueTokens.push(token);
  }
  if (uniqueTokens.length < 2) {
    return actionResult(
      `Which two assets should I swap? Available here: ${TOKEN_VALUES.join(", ")}.`,
      openViewAction("swap")
    );
  }
  const tokenIn = uniqueTokens[0];
  const tokenOut = uniqueTokens[uniqueTokens.length - 1];
  if (!TOKEN_VALUES.includes(tokenIn) || !TOKEN_VALUES.includes(tokenOut) || tokenIn === tokenOut) {
    return actionResult(
      `Choose two different supported assets: ${TOKEN_VALUES.join(", ")}.`,
      openViewAction("swap")
    );
  }

  const amount = actionAmount(question, actionPrompt, 8);
  if (amount.tooPrecise) {
    return actionResult(
      "Swap amounts support up to 8 decimal places. What amount should I use?",
      openViewAction("swap")
    );
  }
  if (!amount.amount) {
    return actionResult(
      `How much ${tokenIn} should I swap to ${tokenOut}?`,
      openViewAction("swap")
    );
  }

  const slippage = slippageDetails(actionPrompt);
  if (slippage.unsupported) {
    return actionResult(
      "Choose a supported slippage setting: 0.5%, 1%, or 3%.",
      openViewAction("swap")
    );
  }

  const action = normalizePreparedWalletAction({
    tool: "prepare_swap",
    args: {
      tokenIn,
      tokenOut,
      amount: amount.amount,
      slippageBps: slippage.value
    }
  });
  return actionResult(
    `I prepared a ${amount.amount} ${tokenIn} → ${tokenOut} swap with ${slippage.value / 100}% slippage. Open it to fetch the live quote and minimum received before signing. ${environmentNote()}`,
    action
  );
}

function bridgeRequest(question, actionPrompt, context) {
  if (mentionsWrongEnvironment(actionPrompt)) {
    return actionResult(
      `This wallet is currently configured for ${NETWORK_LABEL}. I cannot mix mainnet and testnet routes.`,
      openViewAction("bridge")
    );
  }
  if (!MAINNET_ACTIONS_READY) {
    return actionResult(
      `Bridge is not configured for ${NETWORK_LABEL} yet. I will not invent a route.`,
      openViewAction("bridge")
    );
  }

  const amount = actionAmount(question, actionPrompt, 6);
  if (amount.tooPrecise) {
    return actionResult(
      "USDC bridge amounts support up to 6 decimal places. What amount should I use?",
      openViewAction("bridge")
    );
  }
  if (!amount.amount) {
    return actionResult(
      "How much USDC should I prepare to bridge?",
      openViewAction("bridge")
    );
  }

  const mentions = networkMentions(actionPrompt);
  let sourceNetwork = networkAfterCue(actionPrompt, "from");
  let destinationNetwork = networkAfterCue(actionPrompt, "(?:to|into|onto)");
  if (!sourceNetwork) sourceNetwork = walletNetwork(context);
  if (!sourceNetwork && mentions.length >= 2) sourceNetwork = mentions[0];
  if (!destinationNetwork) {
    const choices = mentions.filter((network) => network !== sourceNetwork);
    destinationNetwork = choices[choices.length - 1] || "";
  }

  if (!sourceNetwork) {
    return actionResult(
      "Which source network should the USDC come from?",
      openViewAction("bridge")
    );
  }
  if (!destinationNetwork) {
    return actionResult(
      `Which destination network should receive the ${amount.amount} USDC?`,
      openViewAction("bridge")
    );
  }
  if (sourceNetwork === destinationNetwork) {
    return actionResult(
      "Bridge source and destination must be different. Which destination network should I use?",
      openViewAction("bridge")
    );
  }

  const action = normalizePreparedWalletAction({
    tool: "prepare_bridge",
    args: { sourceNetwork, destinationNetwork, amount: amount.amount }
  });
  return actionResult(
    `I prepared a ${amount.amount} USDC bridge from ${sourceNetwork} to ${destinationNetwork}. Open it to verify balances, the live Circle route, fees and every required signature. ${environmentNote()}`,
    action
  );
}

function switchRequest(actionPrompt) {
  if (mentionsWrongEnvironment(actionPrompt)) {
    return actionResult(
      `This wallet is configured for ${NETWORK_LABEL}; it cannot switch into a different environment from this action.`,
      null
    );
  }
  const networks = networkMentions(actionPrompt);
  const network = networks[networks.length - 1] || "";
  if (!network) {
    return actionResult(
      `Which network should I switch to: ${NETWORK_VALUES.join(", ")}?`,
      null
    );
  }
  const action = normalizePreparedWalletAction({
    tool: "switch_network",
    args: { network }
  });
  return actionResult(
    `I prepared a switch to ${network}. This changes the connected network only; it does not move funds.`,
    action
  );
}

function explicitOpenRequest(prompt) {
  const match = normalizeText(prompt).toLowerCase().match(
    /\b(?:open|go to|show me|take me to)\b[\s\S]*\b(dashboard|portfolio|send|receive|swap|bridge|activity|assistant|agent)\b/
  );
  if (!match) return null;
  const view =
    match[1] === "portfolio"
      ? "dashboard"
      : match[1] === "assistant"
        ? "agent"
        : match[1];
  return actionResult(`I can open ${view} for you.`, openViewAction(view));
}

function resolveActionRequest(question, messages, context) {
  const actionPrompt = previousActionPrompt(question, messages);
  if (!ACTION_WORDS.test(actionPrompt)) return null;

  const openRequest = explicitOpenRequest(actionPrompt);
  if (openRequest) return openRequest;

  if (educationalAction(question)) return walletEducation(question) || walletEducation(actionPrompt);

  const lower = actionPrompt.toLowerCase();
  if (/\b(receive|request)\b/.test(lower)) {
    return actionResult(
      "Open Receive to display your address and QR code. Confirm the sender uses the same network.",
      openViewAction("receive")
    );
  }
  if (/\bswitch\b/.test(lower)) return switchRequest(actionPrompt);
  if (/\bbridge\b/.test(lower)) return bridgeRequest(question, actionPrompt, context);
  if (/\bswap\b/.test(lower)) return swapRequest(question, actionPrompt);
  if (/\b(send|transfer|pay)\b/.test(lower)) {
    return sendRequest(question, actionPrompt, context);
  }
  return null;
}

function portfolioSummary(question, context) {
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
  if (!assets.length) {
    return `No supported assets were found in the latest ${NETWORK_LABEL} balance read.`;
  }

  const requestedToken = tokenMentions(question)[0];
  if (requestedToken) {
    const asset = assets.find((item) => normalizeToken(item?.symbol) === requestedToken);
    return asset
      ? `The latest visible ${requestedToken} balance is ${asset.balanceLabel || `${asset.balance || "0"} ${requestedToken}`}. ${environmentNote()}`
      : `${requestedToken} is not present in the current supported-asset snapshot.`;
  }

  const funded = assets.filter((asset) => Number(asset?.balanceValue ?? asset?.balance ?? 0) > 0);
  const shown = (funded.length ? funded : assets).slice(0, 5);
  const lines = shown.map(
    (asset) => `• ${asset.balanceLabel || `${asset.balance || "0"} ${asset.symbol || "token"}`}`
  );
  const hidden = Math.max(0, (funded.length ? funded : assets).length - shown.length);
  return [
    `${NETWORK_LABEL} portfolio snapshot:`,
    ...lines,
    hidden ? `• ${plural(hidden, "additional asset")} not shown` : "",
    ARC_NETWORK_MODE === "testnet"
      ? "These are testnet balances and have no real-world monetary value."
      : "Balances come from the latest public onchain read; no price total is inferred."
  ]
    .filter(Boolean)
    .join("\n");
}

function activitySummary(context) {
  const items = getActivityItems(context);
  const status = context?.activity?.status;
  if (["loading", "refreshing"].includes(status)) return "Recent activity is still syncing.";
  if (status === "error") return "Recent activity is temporarily unavailable.";
  if (!items.length) return "No recent activity was found in the limited public lookback window.";

  const signals = activitySignals(context);
  const latest = items[0];
  return [
    `${plural(signals.visibleCount, "recent item")} loaded: ${plural(signals.outgoing, "outgoing transfer")}, ${plural(signals.received, "incoming transfer")}, ${plural(signals.approvals, "approval")}, ${plural(signals.pending, "pending item")}, and ${plural(signals.failed, "failed item")}.`,
    `Latest: ${latest.type || "Onchain interaction"}${latest.amount ? ` — ${latest.amount}` : ""}, ${latest.timeLabel || "recently"}; recorded status ${latest.status || "unknown"}.`
  ].join(" ");
}

function reviewSummary(context) {
  const signals = activitySignals(context);
  const parts = [
    `I can inspect only the ${plural(signals.visibleCount, "recent item")} currently loaded. This is not a security audit, guarantee, or risk score.`
  ];
  if (signals.approvals) {
    parts.push(
      `${plural(signals.approvals, "approval")} should be checked against the spender, token and intended allowance.`
    );
  }
  if (signals.outgoing) {
    parts.push(\n      `${plural(signals.outgoing, "outgoing transfer")} ${signals.outgoing === 1 ? "is" : "are"} visible in this window.`\n    );
  }
  if (signals.failed) {
    parts.push(
      `${plural(signals.failed, "failed transaction")} ${signals.failed === 1 ? "is" : "are"} visible; a failure normally means the attempted state change did not complete, but network fees may still have been spent.`
    );
  }
  if (!signals.visibleCount) {
    parts.push("There is not enough visible activity to assess unusual behavior.");
  }
  parts.push("If you do not recognize an approval or transfer, verify it in the explorer before acting.");
  return parts.join(" ");
}

function explainActivity(question, context) {
  const items = getActivityItems(context);
  const hash = normalizeText(question)
    .match(/0x[a-fA-F0-9]{64}/)?.[0]
    ?.toLowerCase();
  const shortHash = normalizeText(question).match(/0x[a-fA-F0-9]{6,16}(?:…|\.\.\.)[a-fA-F0-9]{4,12}/)?.[0];
  const target = hash
    ? items.find((item) => normalizeText(item?.txHash).toLowerCase() === hash)
    : shortHash
      ? items.find((item) => normalizeText(item?.txHashShort).toLowerCase() === shortHash.toLowerCase())
      : items[0];

  if (!target) return activitySummary(context);
  const kind = normalizeText(target.kind).toLowerCase();
  const status = normalizeText(target.status) || "unknown";
  if (kind === "approval") {
    return `This is an approval for ${target.amount || "a token allowance"}. It authorizes a spender rather than directly transferring funds. Confirm the spender and amount in the explorer; Lumexa has not audited the contract. Recorded status: ${status}.`;
  }
  if (kind === "sent") {
    return `This activity sends ${target.amount || "assets"} to ${target.counterparty || "another address"}. Verify the full destination and recorded status (${status}) in the explorer.`;
  }
  if (kind === "received") {
    return `This activity records ${target.amount || "assets"} received from ${target.counterparty || "another address"}. Recorded status: ${status}.`;
  }
  if (kind.includes("bridge")) {
    return `This is recorded as a bridge action for ${target.amount || "USDC"}. Cross-chain completion can require separate source and destination steps. Recorded status: ${status}.`;
  }
  return `${target.summary || target.type || "This is an onchain interaction."} The recorded status is ${status}.`;
}

function networkSummary(context) {
  const wallet = context?.wallet || {};
  const gasSymbol = arcTestnet.nativeCurrency.symbol;
  if (!wallet.connected) {
    return `Connect a wallet to check its active network. ${NETWORK_LABEL} uses ${gasSymbol} for gas.`;
  }
  if (!wallet.onArc) {
    return `The connected wallet is on ${wallet.network || "another network"}, not ${NETWORK_LABEL}. Switch to chain ${arcTestnet.id} to use Arc actions.`;
  }
  return `The wallet is connected to ${NETWORK_LABEL} (chain ${arcTestnet.id}). Gas is paid in ${gasSymbol}; the exact fee is estimated before you sign. ${environmentNote()}`;
}

function capabilitiesSummary() {
  const transactionTools = [
    "analyze visible balances and recent activity",
    "explain transactions, approvals, gas and network state",
    "prepare USDC sends",
    ...(TOKEN_VALUES.length >= 2 && MAINNET_ACTIONS_READY ? ["prepare supported token swaps"] : []),
    ...(MAINNET_ACTIONS_READY ? ["prepare USDC bridges"] : []),
    "switch supported networks and open wallet screens"
  ];
  return `I can ${transactionTools.join("; ")}. Ask naturally, for example: “Send 5 USDC to 0x…”, “Swap 10 USDC to EURC”, or “Explain my latest transaction.” Every transaction remains review-only until you sign it.`;
}

function detectIntent(question) {
  const prompt = normalizeText(question).toLowerCase();
  if (!prompt) return "general_wallet_help";
  if (/\b(seed phrase|recovery phrase|private key|secret key|password)\b/.test(prompt)) {
    return "secret_safety";
  }
  if (/^(hi|hello|hey|good (?:morning|afternoon|evening))\b/.test(prompt)) return "greeting";
  if (
    /\b(what can you do|help menu|capabilities|how can you help|available commands)\b/.test(prompt)
  ) {
    return "capabilities";
  }
  if (/\b(risk|safe|safety|approve|approval|allowance|suspicious|scam)\b/.test(prompt)) {
    return "activity_review";
  }
  if (/\b(contract|transaction|activity|latest|pending|failed|explain)\b/.test(prompt)) {
    return "activity_explainer";
  }
  if (/\b(balances?|portfolio|holding|holdings|asset|assets|how much)\b/.test(prompt)) {
    return "portfolio_snapshot";
  }
  if (/\b(gas|fee|fees|network|chain)\b/.test(prompt)) return "network_help";
  return "wallet_summary";
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
      body: `${plural(signals.visibleCount, "recent item")}, ${plural(signals.outgoing, "outgoing transfer")}, ${plural(signals.approvals, "approval")}, and ${plural(signals.failed, "failure")} are loaded. This is not a security assessment.`,
      tone: signals.approvals || signals.failed ? "warning" : "neutral"
    },
    {
      id: "portfolio-holdings",
      title: "Tracked assets",
      body: assets.length
        ? `${plural(assets.length, "supported asset")} visible in the current snapshot.`
        : "No supported assets are visible in the current snapshot.",
      tone: "neutral"
    }
  ];
  if (latest) {
    insights.push({
      id: "latest-activity",
      title: "Latest activity",
      body: `${latest.type || "Onchain interaction"}${latest.amount ? ` — ${latest.amount}` : ""}. Status: ${latest.status || "unknown"}.`,
      tone:
        normalizeText(latest.status).toLowerCase() === "failed" ||
        normalizeText(latest.kind).toLowerCase() === "approval"
          ? "warning"
          : "neutral"
    });
  }
  return insights.slice(0, 4);
}

export function buildContextDigest(context) {
  const wallet = context?.wallet || {};
  const portfolio = context?.portfolio || {};
  const activity = context?.activity || {};
  const assets = getAssets(context).slice(0, 8);
  const items = getActivityItems(context).slice(0, 8);
  return {
    environment: {
      networkMode: ARC_NETWORK_MODE,
      networkLabel: NETWORK_LABEL,
      arcChainId: arcTestnet.id,
      gasToken: arcTestnet.nativeCurrency.symbol,
      supportedNetworks: NETWORK_VALUES,
      supportedTokens: TOKEN_VALUES
    },
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
      signals: activitySignals(context),
      items: items.map((item) => ({
        type: normalizeText(item.type).slice(0, 60),
        amount: normalizeText(item.amount).slice(0, 80),
        summary: redactContextIdentifiers(item.summary).slice(0, 180),
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
            "Never invent balances, prices, transaction status, contract behavior, routes, quotes, or production support.",
            "A wallet action is prepared for review only; the user must approve and sign it.",
            "Never ask for a seed phrase, private key, password, or signing secret.",
            "Identify uncertainty, use recent conversation for follow-ups, and ask one concise question when a required action detail is missing.",
            "Return concise plain text because the wallet does not render Markdown."
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
            `User question: ${redactFullTransactionHashes(question).slice(0, 800)}`
          ].join("\n\n")
        }
      ]
    }
  ];
}

export function generateLocalAssistantResponse({ question, messages, context }) {
  const actionResponse = resolveActionRequest(question, messages, context);
  let answer;
  let actions = [];

  if (actionResponse) {
    answer = actionResponse.answer;
    actions = actionResponse.actions;
  } else {
    const intent = detectIntent(question);
    if (intent === "secret_safety") {
      answer =
        "Never share a seed phrase, recovery phrase, private key, password, or signing secret with Lumexa or anyone else. Lumexa does not need them to analyze public wallet data or prepare an action.";
    } else if (intent === "greeting") {
      answer = `Hi — I’m Lumexa. I can analyze this wallet, explain onchain activity, and safely prepare review-only actions. ${capabilitiesSummary()}`;
    } else if (intent === "capabilities") {
      answer = capabilitiesSummary();
    } else if (intent === "activity_explainer") {
      answer = `${explainActivity(question, context)} ${networkSummary(context)}`;
    } else if (intent === "activity_review") {
      answer = reviewSummary(context);
    } else if (intent === "portfolio_snapshot") {
      answer = portfolioSummary(question, context);
    } else if (intent === "network_help") {
      answer = networkSummary(context);
    } else {
      answer = `${portfolioSummary(question, context)} ${activitySummary(context)} Ask “what can you do?” for wallet commands.`;
    }
  }

  return {
    answer,
    insights: buildWalletInsights(context),
    actions: actions.filter(Boolean).slice(0, 3),
    notice: "Lumexa local intelligence · private",
    mode: "local-intelligence",
    provider: "lumexa-local"
  };
}
