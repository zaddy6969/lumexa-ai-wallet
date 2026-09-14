import {
  buildAssistantInput,
  generateLocalAssistantResponse,
  normalizePreparedWalletAction
} from "./wallet-copilot";
import {
  enforceRateLimit,
  hasOversizedJsonBody,
  rejectCrossSiteRequest,
  setNoStore
} from "./api-security";

const GATEWAY_API_URL = "https://ai-gateway.vercel.sh/v1/responses";
const OPENAI_API_URL = "https://api.openai.com/v1/responses";
const GATEWAY_MODEL = process.env.AI_GATEWAY_MODEL || "openai/gpt-5.6-sol";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.6-sol";
const REQUEST_TIMEOUT_MS = 25_000;

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

function shouldUseInstantWalletAnswer(question) {
  const prompt = normalizeText(question).toLowerCase();
  if (!prompt) return false;

  const asksForTransactionAction = /\b(send|swap|bridge|switch|transfer|pay|open)\b/.test(prompt);
  if (asksForTransactionAction) return false;

  return (
    /\b(balance|portfolio|holding|holdings|asset|assets|activity|transaction|transactions|latest|risk|safe|safety|approval|allowance|contract|network|gas|fee|fees|status|analyze|analyse|review)\b/.test(
      prompt
    ) || prompt.includes("my wallet")
  );
}

function getInstantWalletAnswer(question, messages, context) {
  if (!shouldUseInstantWalletAnswer(question)) return null;
  try {
    const result = generateLocalAssistantResponse({ question, messages, context });
    if (!result?.answer) return null;
    return {
      ...result,
      notice: "Lumexa verified wallet analysis",
      mode: "local-intelligence",
      provider: "lumexa-local"
    };
  } catch {
    return null;
  }
}

function getProvider() {
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

  const gatewayKey = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || "";
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

function toolCallToAction(item) {
  if (!item || item.type !== "function_call") return null;
  return normalizePreparedWalletAction({
    id: `${item.name || "action"}-${item.call_id || Date.now()}`,
    tool: item.name,
    args: parseToolArguments(item.arguments)
  });
}

function getToolActions(payload) {
  return (Array.isArray(payload?.output) ? payload.output : [])
    .map(toolCallToAction)
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
    return `I can switch your connected wallet to ${action.args.network}. This changes the active network only and does not move funds.`;
  }
  if (action.tool === "open_wallet_view") {
    return `I can open the ${action.args.view} screen for you.`;
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
          "Respond naturally to greetings, small talk, and general questions. Do not recite the wallet summary unless the user asks about the wallet.",
          "For wallet-specific claims, use the supplied wallet context and never invent balances, activity, transaction status, risk facts, token addresses, RPC endpoints, or production support.",
          "For general non-wallet questions, answer normally using your model knowledge while staying concise.",
          "When a user gives enough information for an available Send, Swap, Bridge, or network-switching tool, call the matching function tool instead of merely describing steps.",
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
        reasoning: { effort: "medium" },
        max_output_tokens: 700,
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

    const actions = getToolActions(payload);
    const answer = extractOutputText(payload) || answerForActions(actions);
    if (!answer && !actions.length) throw new Error("AI provider returned an empty response.");

    return { answer, actions };
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

export async function handleWalletChat(req, res) {
  const provider = getProvider();
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
      localAvailable: true,
      cloudAvailable: Boolean(provider),
      provider: provider?.provider || null,
      model: provider?.model || null,
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

  const instantAnswer = getInstantWalletAnswer(
    normalizedQuestion,
    normalizedMessages,
    context
  );
  if (!provider) {
    return res.status(200).json(
      instantAnswer ||
        generateLocalAssistantResponse({
          question: normalizedQuestion,
          messages: normalizedMessages,
          context
        })
    );
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
      notice: `Lumexa Agent · ${provider.model}`,
      mode: "ai-copilot",
      provider: provider.provider
    });
  } catch (error) {
    const localRecovery = getInstantWalletAnswer(
      normalizedQuestion,
      normalizedMessages,
      context
    );
    if (localRecovery) {
      return res.status(200).json(localRecovery);
    }

    console.warn("[wallet-copilot] cloud AI unavailable; returning local response", {
      provider: provider.provider,
      status: Number(error?.status) || 0
    });

    return res
      .status(200)
      .json(
        localRecovery ||
          generateLocalAssistantResponse({
            question: normalizedQuestion,
            messages: normalizedMessages,
            context
          })
      );
  }
}
