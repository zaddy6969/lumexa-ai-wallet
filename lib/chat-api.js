import {
  buildAssistantInput,
  normalizePreparedWalletAction,
  resolveRepeatLatestAction
} from "./wallet-copilot.js";
import {
  enforceRateLimit,
  hasOversizedJsonBody,
  rejectCrossSiteRequest,
  setNoStore
} from "./api-security.js";

const GATEWAY_API_URL = "https://ai-gateway.vercel.sh/v1/responses";
const OPENAI_API_URL = "https://api.openai.com/v1/responses";
const GATEWAY_MODEL = process.env.AI_GATEWAY_MODEL || "openai/gpt-6-astra";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-6-astra";
const GATEWAY_FALLBACK_MODELS = (process.env.AI_GATEWAY_FALLBACK_MODELS || "openai/gpt-5.6-sol")
  .split(",")
  .map((model) => model.trim())
  .filter(
    (model, index, models) => model && model !== GATEWAY_MODEL && models.indexOf(model) === index
  )
  .slice(0, 3);
const REQUEST_TIMEOUT_MS = 45_000;

const ARC_NETWORK_MODE =
  String(process.env.NEXT_PUBLIC_ARC_NETWORK || "testnet").toLowerCase() === "mainnet"
    ? "mainnet"
    : "testnet";
const ARC_MAINNET = ARC_NETWORK_MODE === "mainnet";
const ARC_NETWORK_LABEL = ARC_MAINNET ? "Arc Mainnet" : "Arc Testnet";
const NETWORK_VALUES = ARC_MAINNET
  ? ["arc", "ethereum-mainnet", "base-mainnet"]
  : ["arc", "ethereum-sepolia", "base-sepolia"];
const TOKEN_VALUES = ARC_MAINNET
  ? [
      "USDC",
      ...(process.env.NEXT_PUBLIC_ARC_MAINNET_EURC_ADDRESS ? ["EURC"] : []),
      ...(process.env.NEXT_PUBLIC_ARC_MAINNET_CIRBTC_ADDRESS ? ["cirBTC"] : [])
    ]
  : ["USDC", "EURC", "cirBTC"];
const MAINNET_APP_KIT_READY =
  !ARC_MAINNET ||
  [
    process.env.NEXT_PUBLIC_ARC_MAINNET_APP_KIT_CHAIN,
    process.env.NEXT_PUBLIC_ARC_MAINNET_APP_KIT_MODULE_KEY,
    process.env.NEXT_PUBLIC_ETHEREUM_MAINNET_APP_KIT_CHAIN,
    process.env.NEXT_PUBLIC_ETHEREUM_MAINNET_APP_KIT_MODULE_KEY,
    process.env.NEXT_PUBLIC_BASE_MAINNET_APP_KIT_CHAIN,
    process.env.NEXT_PUBLIC_BASE_MAINNET_APP_KIT_MODULE_KEY
  ].every(Boolean);

function buildCopilotTools() {
  const tools = [
    {
      type: "function",
      name: "prepare_send",
      description: `Prepare a self-custodial USDC transfer on ${ARC_NETWORK_LABEL}. Use only when both recipient address and amount are known. The user will review and sign in their wallet.`,
      strict: true,
      parameters: {
        type: "object",
        properties: {
          recipient: { type: "string", description: "A full 0x EVM recipient address." },
          amount: {
            type: "string",
            description: "Positive USDC amount written as a decimal string."
          }
        },
        required: ["recipient", "amount"],
        additionalProperties: false
      }
    }
  ];

  if ((!ARC_MAINNET || MAINNET_APP_KIT_READY) && TOKEN_VALUES.length >= 2) {
    tools.push({
      type: "function",
      name: "prepare_swap",
      description: `Prepare a token swap on ${ARC_NETWORK_LABEL}. Use only when input token, output token and amount are known. The user will review a live quote and sign in their wallet.`,
      strict: true,
      parameters: {
        type: "object",
        properties: {
          tokenIn: { type: "string", enum: TOKEN_VALUES },
          tokenOut: { type: "string", enum: TOKEN_VALUES },
          amount: {
            type: "string",
            description: "Positive input token amount written as a decimal string."
          },
          slippageBps: {
            type: "integer",
            enum: [50, 100, 300],
            description:
              "Slippage in basis points. Use 100 unless the user explicitly chooses another supported value."
          }
        },
        required: ["tokenIn", "tokenOut", "amount", "slippageBps"],
        additionalProperties: false
      }
    });
  }

  if (!ARC_MAINNET || MAINNET_APP_KIT_READY) {
    tools.push({
      type: "function",
      name: "prepare_bridge",
      description: ARC_MAINNET
        ? "Prepare a USDC bridge between Arc Mainnet, Ethereum Mainnet and Base Mainnet. Source and destination must differ. The wallet will fetch a live production quote before the user signs."
        : "Prepare a USDC bridge between Arc Testnet, Ethereum Sepolia and Base Sepolia. Source and destination must differ. The wallet will fetch a live testnet quote before the user signs.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          sourceNetwork: { type: "string", enum: NETWORK_VALUES },
          destinationNetwork: { type: "string", enum: NETWORK_VALUES },
          amount: {
            type: "string",
            description: "Positive USDC amount written as a decimal string."
          }
        },
        required: ["sourceNetwork", "destinationNetwork", "amount"],
        additionalProperties: false
      }
    });
  }

  tools.push({
    type: "function",
    name: "repeat_latest_transaction",
    description:
      "Reconstruct the latest confirmed outgoing send, swap, or bridge from private wallet context and prepare it again for review. Use this whenever the user asks to repeat, redo, duplicate, recreate, or do their transaction/action again. Do not guess its parameters or call another transaction tool for this request.",
    strict: true,
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false
    }
  });

  tools.push(
    {
      type: "function",
      name: "switch_network",
      description: ARC_MAINNET
        ? "Ask the connected wallet to switch to Arc Mainnet, Ethereum Mainnet or Base Mainnet. Network switching does not move funds."
        : "Ask the connected wallet to switch to Arc Testnet, Ethereum Sepolia or Base Sepolia. Network switching does not move funds.",
      strict: true,
      parameters: {
        type: "object",
        properties: { network: { type: "string", enum: NETWORK_VALUES } },
        required: ["network"],
        additionalProperties: false
      }
    },
    {
      type: "function",
      name: "open_wallet_view",
      description:
        "Open a wallet screen when the user asks to view a feature but has not provided enough information to prepare a transaction.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          view: {
            type: "string",
            enum: ["dashboard", "send", "receive", "swap", "bridge", "activity", "agent"]
          }
        },
        required: ["view"],
        additionalProperties: false
      }
    }
  );

  return tools;
}

const COPILOT_TOOLS = buildCopilotTools();

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getProvider(req) {
  const openAiKey =
    process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || process.env.AI_API_KEY || "";

  if (openAiKey) {
    return {
      apiKey: openAiKey,
      apiUrl: OPENAI_API_URL,
      model: OPENAI_MODEL,
      provider: "openai"
    };
  }

  const runtimeOidc = normalizeText(req?.headers?.["x-vercel-oidc-token"]);
  const gatewayKey =
    process.env.AI_GATEWAY_API_KEY || runtimeOidc || process.env.VERCEL_OIDC_TOKEN || "";
  if (gatewayKey) {
    return {
      apiKey: gatewayKey,
      apiUrl: GATEWAY_API_URL,
      model: GATEWAY_MODEL,
      provider: "vercel-ai-gateway"
    };
  }

  return null;
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const outputs = Array.isArray(payload?.output) ? payload.output : [];
  const parts = [];

  for (const item of outputs) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;
    for (const contentItem of item.content) {
      if (contentItem?.type === "output_text" && contentItem.text) parts.push(contentItem.text);
    }
  }

  return parts.join("\n").trim();
}

function parseToolArguments(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function toolCallToResult(item, context) {
  if (!item || item.type !== "function_call") return null;

  if (item.name === "repeat_latest_transaction") {
    const result = resolveRepeatLatestAction(context);
    return {
      action: result?.actions?.[0] || null,
      answer: normalizeText(result?.answer)
    };
  }

  const action = normalizePreparedWalletAction({
    id: `${item.name || "action"}-${item.call_id || Date.now()}`,
    tool: item.name,
    args: parseToolArguments(item.arguments)
  });
  return action ? { action, answer: "" } : null;
}

function getToolResults(payload, context) {
  return (Array.isArray(payload?.output) ? payload.output : [])
    .map((item) => toolCallToResult(item, context))
    .filter(Boolean)
    .slice(0, 3);
}

function answerForActions(actions) {
  const action = actions[0];
  if (!action) return "";

  if (action.tool === "prepare_send") {
    return `I prepared a ${action.args.amount} USDC transfer to ${action.args.recipient} on ${ARC_NETWORK_LABEL}. Review the recipient, amount and live network fee before signing.`;
  }
  if (action.tool === "prepare_swap") {
    return `I prepared a ${action.args.amount} ${action.args.tokenIn} → ${action.args.tokenOut} swap on ${ARC_NETWORK_LABEL}. Open it to fetch the live quote before signing.`;
  }
  if (action.tool === "prepare_bridge") {
    return `I prepared a ${action.args.amount} USDC bridge from ${action.args.sourceNetwork} to ${action.args.destinationNetwork}. The Bridge screen will verify balances, fees and the live route before signing.`;
  }
  if (action.tool === "switch_network") {
    return `I’m opening a request to switch your connected wallet to ${action.args.network}. This changes the active network only and does not move funds.`;
  }
  if (action.tool === "open_wallet_view") {
    return `I’m opening the ${action.args.view} screen for you.`;
  }
  return "I prepared the wallet action for your review.";
}

async function requestModel({ question, messages, context, provider }) {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(provider.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: provider.model,
        instructions: [
          "You are Lumexa AI Agent inside Lumexa AI Wallet, a self-custodial wallet built on Arc.",
          `The active wallet environment is ${ARC_NETWORK_LABEL}. Never mix testnet and mainnet routes, token addresses, balances, or network switches.`,
          "You are a real model-backed wallet agent: understand the user’s natural language, reason over the supplied wallet snapshot, and use wallet tools when an action is requested.",
          "Respond naturally to greetings, small talk, and general questions. Do not recite a generic wallet summary unless the user asks for one.",
          "For wallet-specific claims, use the supplied wallet context and never invent balances, activity, transaction status, risk facts, token addresses, RPC endpoints, or production support.",
          "When the user asks to analyze, inspect the exact requested balances, activity, statuses, approvals, or network signals in the snapshot and give a specific evidence-based answer. State when the loaded data is insufficient.",
          "For general non-wallet questions, answer normally using your model knowledge while staying concise.",
          "When a user commands Send, Swap, Bridge, navigation, or network switching and the required details are present, call the matching function tool instead of merely describing steps or saying you can do it.",
          "When the user asks to repeat, redo, duplicate, recreate, or do a transaction/action again, call repeat_latest_transaction. It resolves exact private details locally; do not guess them.",
          "If a transaction tool is not available in the active environment, say that integration is not configured rather than inventing a route.",
          "A tool call only PREPARES an action. Never claim a transaction was submitted, confirmed, signed, or completed.",
          "Never request or expose seed phrases, private keys, or signing secrets.",
          "If required transaction details are missing, ask one concise follow-up question rather than guessing.",
          "Think through wallet context and action requirements carefully, then answer in concise plain text without Markdown."
        ].join(" "),
        input: buildAssistantInput(question, messages, context),
        tools: COPILOT_TOOLS,
        tool_choice: "auto",
        parallel_tool_calls: false,
        reasoning: { effort: "high" },
        max_output_tokens: 900,
        ...(provider.provider === "vercel-ai-gateway" && GATEWAY_FALLBACK_MODELS.length
          ? {
              providerOptions: {
                gateway: {
                  models: GATEWAY_FALLBACK_MODELS,
                  tags: ["feature:lumexa-wallet-agent"]
                }
              }
            }
          : {}),
        store: false
      })
    });

    let payload = {};
    try {
      payload = await response.json();
    } catch {}

    if (!response.ok) {
      const error = new Error(payload?.error?.message || "AI provider rejected the request.");
      error.status = response.status;
      throw error;
    }

    const toolResults = getToolResults(payload, context);
    const actions = toolResults.map((result) => result.action).filter(Boolean);
    const toolAnswer = toolResults.map((result) => result.answer).find(Boolean) || "";
    const answer = extractOutputText(payload) || toolAnswer || answerForActions(actions);
    if (!answer && !actions.length) throw new Error("AI provider returned an empty response.");

    return { answer, actions, model: normalizeText(payload?.model) || provider.model };
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

export async function handleWalletChat(req, res) {
  const provider = getProvider(req);
  setNoStore(res);

  if (
    !enforceRateLimit(req, res, {
      scope: req.method === "POST" ? "ai-write" : "ai-status",
      limit: req.method === "POST" ? 20 : 60
    })
  )
    return;

  if (req.method === "GET") {
    return res.status(200).json({
      ready: true,
      localAvailable: false,
      deterministicToolValidation: true,
      cloudAvailable: Boolean(provider),
      realAiAvailable: Boolean(provider),
      provider: provider?.provider || null,
      model: provider?.model || null,
      fallbackModels: provider?.provider === "vercel-ai-gateway" ? GATEWAY_FALLBACK_MODELS : [],
      network: ARC_NETWORK_LABEL,
      tools: COPILOT_TOOLS.map((tool) => tool.name)
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  if (rejectCrossSiteRequest(req, res)) return;
  if (hasOversizedJsonBody(req, 32_000)) {
    return res.status(413).json({ error: "Request is too large." });
  }

  const { question, messages, context } = req.body || {};
  const normalizedQuestion = normalizeText(question);

  if (!normalizedQuestion) {
    return res.status(400).json({ error: "A question is required." });
  }

  if (normalizedQuestion.length > 800) {
    return res.status(400).json({ error: "Keep questions under 800 characters." });
  }

  const normalizedMessages = (Array.isArray(messages) ? messages : [])
    .filter((message) => ["user", "assistant"].includes(message?.role))
    .map((message) => ({
      role: message.role,
      content: normalizeText(message.content).slice(0, 1_000)
    }))
    .filter((message) => message.content)
    .slice(-8);

  if (!provider) {
    return res.status(503).json({
      error: "Lumexa real AI is not configured. Connect an AI provider and try again.",
      code: "AI_NOT_CONFIGURED",
      mode: "unavailable"
    });
  }

  try {
    const result = await requestModel({
      question: normalizedQuestion,
      messages: normalizedMessages,
      context,
      provider
    });

    return res.status(200).json({
      answer: result.answer,
      actions: result.actions,
      notice: `Lumexa AI Agent · ${result.model}`,
      mode: "ai-agent",
      provider: provider.provider,
      model: result.model
    });
  } catch (error) {
    console.warn("[wallet-agent] model request failed", {
      provider: provider.provider,
      model: provider.model,
      status: Number(error?.status) || 0
    });
    const providerStatus = Number(error?.status) || 0;
    const status = providerStatus === 429 ? 429 : providerStatus === 402 ? 503 : 502;
    const message =
      providerStatus === 429
        ? "Lumexa AI is receiving too many requests. Wait a moment and try again."
        : providerStatus === 402
          ? "Lumexa AI usage is temporarily unavailable. Check the AI Gateway budget."
          : "Lumexa AI could not complete this request. Please try again.";
    return res.status(status).json({
      error: message,
      code: "AI_PROVIDER_UNAVAILABLE",
      mode: "unavailable"
    });
  }
}
