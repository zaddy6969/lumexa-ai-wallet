const ACTION_TOOLS = new Set(["prepare_send", "prepare_swap", "prepare_bridge"]);
const REPEAT_RE = /\b(repeat|again|same|redo|re-do|recreate|one more time|do that again|do it again)\b/i;

function text(value) { return typeof value === "string" ? value.trim() : ""; }
function actionId(tool) { return `agent-${tool}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
function result(answer, action = null) {
  return { answer, actions: action ? [action] : [], notice: "Lumexa Agent", mode: "lumexa-agent", provider: "lumexa-action-engine" };
}
function action(tool, args, label) { return { id: actionId(tool), kind: "wallet-action", tool, label, args }; }

const ONES = {zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19};
const TENS = {twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};
function wordsToNumber(input) {
  const words = text(input).toLowerCase().replace(/-/g, " ").split(/\s+/);
  let total = 0, current = 0, seen = false, decimal = "", afterPoint = false;
  for (const word of words) {
    if (word === "and") continue;
    if (word === "point") { if (!seen) return null; afterPoint = true; continue; }
    if (afterPoint) {
      if (Object.hasOwn(ONES, word) && ONES[word] < 10) { decimal += String(ONES[word]); continue; }
      break;
    }
    if (Object.hasOwn(ONES, word)) { current += ONES[word]; seen = true; continue; }
    if (Object.hasOwn(TENS, word)) { current += TENS[word]; seen = true; continue; }
    if (word === "hundred" && seen) { current *= 100; continue; }
    if (word === "thousand" && seen) { total += current * 1000; current = 0; continue; }
    if (seen) break;
  }
  if (!seen) return null;
  const value = total + current;
  return decimal ? `${value}.${decimal}` : String(value);
}

function extractAmount(prompt) {
  const p = text(prompt);
  const numericPatterns = [
    /(?:swap|send|transfer|pay|bridge)\s+(?:exactly\s+|about\s+)?\$?([0-9][0-9,]*(?:\.[0-9]+)?)/i,
    /\$\s*([0-9][0-9,]*(?:\.[0-9]+)?)/,
    /([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:usdc|usd\s*coin|dollars?|eurc|euros?|cir\s*btc|usdt|tether)\b/i,
    /\bamount(?:\s+is|\s+of|\s*[:=])?\s*\$?([0-9][0-9,]*(?:\.[0-9]+)?)/i
  ];
  for (const pattern of numericPatterns) {
    const match = p.match(pattern);
    if (match) return match[1].replace(/,/g, "");
  }
  const actionWords = p.match(/\b(?:swap|send|transfer|pay|bridge)\s+([a-z -]+?)(?=\s+(?:usdc|usd\s*coin|dollars?|eurc|euros?|cir\s*btc|usdt|tether|to|from|into|on)\b|$)/i);
  return actionWords ? wordsToNumber(actionWords[1]) : null;
}

function tokenMentions(prompt) {
  const p = text(prompt).toLowerCase();
  const hits = [];
  const patterns = [
    ["USDT", /\b(usdt|tether)\b/g],
    ["USDC", /\b(usdc|usd\s*coin|dollars?|bucks?)\b|\$/g],
    ["EURC", /\b(eurc|euro\s*coin|euros?)\b|€/g],
    ["cirBTC", /\b(cir\s*btc|circle\s*bitcoin)\b/g]
  ];
  for (const [token, pattern] of patterns) for (const match of p.matchAll(pattern)) hits.push({ token, index: match.index || 0 });
  return hits.sort((a,b) => a.index-b.index).map((hit) => hit.token);
}

function networkMentions(prompt) {
  const p = text(prompt).toLowerCase();
  const hits = [];
  const patterns = [
    ["arc", /\barc(?:\s+(?:testnet|mainnet))?\b/g],
    ["ethereum-sepolia", /\b(?:ethereum|eth)(?:\s+sepolia)?\b/g],
    ["base-sepolia", /\bbase(?:\s+sepolia)?\b/g]
  ];
  for (const [network, pattern] of patterns) for (const match of p.matchAll(pattern)) hits.push({ network, index: match.index || 0 });
  return hits.sort((a,b) => a.index-b.index).map((hit) => hit.network);
}

function fullAddress(prompt) { return text(prompt).match(/0x[a-fA-F0-9]{40}\b/)?.[0]?.toLowerCase() || ""; }
function validAmount(value) { return value && /^\d+(?:\.\d+)?$/.test(value) && Number(value) > 0 ? value : ""; }
function lastActionFrom(body) {
  const supplied = body?.context?.lastAction;
  if (supplied && ACTION_TOOLS.has(supplied.tool) && supplied.args) return supplied;
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role !== "user") continue;
    const parsed = resolveTransactionCommand(messages[i].content, {}, false);
    if (parsed?.actions?.[0] && ACTION_TOOLS.has(parsed.actions[0].tool)) return parsed.actions[0];
  }
  return null;
}

function repeatAction(body) {
  const previous = lastActionFrom(body);
  if (!previous) return result("I don't have enough transaction context to repeat yet. Tell me the action once in normal English, and I’ll remember it for this session.");
  const copied = action(previous.tool, { ...previous.args }, `Repeat ${previous.label || previous.tool}`);
  if (previous.tool === "prepare_swap") return result(`Repeating exactly: swap ${copied.args.amount} ${copied.args.tokenIn} to ${copied.args.tokenOut}. I filled the Swap screen with those values; your wallet still controls the final signature.`, copied);
  if (previous.tool === "prepare_bridge") return result(`Repeating exactly: bridge ${copied.args.amount} USDC from ${copied.args.sourceNetwork} to ${copied.args.destinationNetwork}. I filled the Bridge screen with those values.`, copied);
  return result(`Repeating exactly: send ${copied.args.amount} USDC to ${copied.args.recipient}. I filled the Send screen with those values.`, copied);
}

function resolveTransactionCommand(prompt, body = {}, allowRepeat = true) {
  const p = text(prompt);
  const lower = p.toLowerCase();
  if (!p) return null;
  if (allowRepeat && REPEAT_RE.test(lower) && !/\b(swap|send|transfer|pay|bridge)\b/.test(lower)) return repeatAction(body);

  if (/\bswap\b|\bexchange\b|\bconvert\b/.test(lower)) {
    const amount = validAmount(extractAmount(p));
    const tokens = tokenMentions(p);
    if (tokens.includes("USDT")) return result("USDT is not a supported asset in this Lumexa Arc build. I won't silently replace it with another token. If you mean USDC, say for example: “Swap 50 USDC to EURC.”");
    let tokenIn = tokens[0] || "";
    let tokenOut = tokens[tokens.length - 1] || "";
    if (tokens.length === 1 && tokenOut === "EURC") tokenIn = "USDC";
    if (tokens.length === 1 && tokenOut === "USDC") tokenIn = "EURC";
    if (!amount) return result("Tell me the exact amount to swap, for example: “Swap 50 USDC to EURC.”");
    if (!tokenIn || !tokenOut || tokenIn === tokenOut) return result("Tell me both assets, for example: “Swap 50 USDC to EURC.”");
    const prepared = action("prepare_swap", { tokenIn, tokenOut, amount, slippageBps: 100 }, `Swap ${amount} ${tokenIn} to ${tokenOut}`);
    return result(`Got it. I’m using exactly ${amount} ${tokenIn} → ${tokenOut}. I filled those values in Swap and the live quote will be fetched there.`, prepared);
  }

  if (/\bbridge\b|\bmove\b.*\b(?:chain|network)\b/.test(lower)) {
    const amount = validAmount(extractAmount(p));
    const networks = networkMentions(p);
    let sourceNetwork = networks[0] || "arc";
    let destinationNetwork = networks[networks.length - 1] || "";
    if (networks.length === 1 && destinationNetwork === sourceNetwork) {
      destinationNetwork = sourceNetwork;
      sourceNetwork = "arc";
    }
    if (!amount) return result("Tell me the exact USDC amount to bridge.");
    if (!destinationNetwork || sourceNetwork === destinationNetwork) return result("Tell me the source and destination networks, for example: “Bridge 20 USDC from Arc to Base.”");
    const prepared = action("prepare_bridge", { sourceNetwork, destinationNetwork, amount }, `Bridge ${amount} USDC`);
    return result(`Got it. I’m using exactly ${amount} USDC from ${sourceNetwork} to ${destinationNetwork}. I filled those values in Bridge so it can fetch the live route.`, prepared);
  }

  if (/\b(send|transfer|pay)\b/.test(lower)) {
    const amount = validAmount(extractAmount(p));
    const recipient = fullAddress(p);
    if (/\b(usdt|tether)\b/i.test(p)) return result("Lumexa Send currently supports USDC in this build, not USDT. I won't change the asset without telling you.");
    if (!amount) return result("How much USDC do you want to send?");
    if (!recipient) return result(`I have the amount: exactly ${amount} USDC. Now send me the full recipient address beginning with 0x, and I’ll fill Send for you.`);
    const prepared = action("prepare_send", { recipient, amount }, `Send ${amount} USDC`);
    return result(`Got it. I’m using exactly ${amount} USDC to ${recipient}. I filled Send with the amount and recipient; verify it before signing.`, prepared);
  }
  return null;
}

function education(prompt) {
  const p = text(prompt).toLowerCase();
  if (/\bwhat is arc\b|\bexplain arc\b|\bwhy arc\b/.test(p)) return result("Arc is an EVM-compatible network designed for stablecoin-native economic activity. A key UX idea is predictable dollar-denominated execution with USDC used as the gas asset. Lumexa is built on Arc to make those wallet actions easier for people who don't want to think in raw blockchain steps.");
  if (/\bwhat is lumexa\b|\bwhy lumexa\b|\bwhat can lumexa\b/.test(p)) return result("Lumexa is a self-custodial AI wallet interface built around Arc. Its job is to turn normal language into understandable wallet actions: explain balances and activity, fill Send/Swap/Bridge details, fetch live quotes where available, and guide you through the final wallet approval without ever taking your private key.");
  if (/\bhow (?:do i |to )?(?:send|transfer)\b/.test(p)) return result("To send in Lumexa, you can simply say: “Send 25 USDC to 0x…”. I extract the exact amount and recipient, fill the Send screen, show the network and fee information, and your connected wallet gives the final signature.");
  if (/\bhow (?:do i |to )?(?:swap|exchange|convert)\b/.test(p)) return result("To swap, say something natural like: “Swap 25 USDC to EURC.” I use the exact input amount and pair, fill Swap, then the wallet requests a live route/quote. If Arc Testnet has no route for that pair, I’ll tell you instead of inventing a price.");
  if (/\bhow (?:do i |to )?bridge\b/.test(p)) return result("To bridge, say for example: “Bridge 20 USDC from Arc to Base.” I fill the amount and route, then Lumexa checks the live bridge path and required wallet steps. The final signatures always stay with your connected wallet.");
  if (/\b(networks?|chains?)\b/.test(p) && /\b(lumexa|support|available|which|what)\b/.test(p)) return result("This Lumexa build is currently running on Arc Testnet and its test flow uses Ethereum Sepolia and Base Sepolia for supported cross-network actions. Mainnet configuration must use the official production chain and token settings before real-value transfers are enabled.");
  if (/\bbackend\b|\bunder the hood\b|\bhow does lumexa work\b/.test(p)) return result("Under the hood, Lumexa combines a connected self-custodial EVM wallet, Arc network reads, Circle App Kit transaction/quote flows, recent onchain activity, and an AI action layer. The AI interprets normal English and prepares structured actions; the transaction panels validate balances/routes/fees; the wallet itself keeps custody and signs.");
  return null;
}

export function resolveNaturalWalletAgent(body) {
  const question = text(body?.question);
  if (!question) return null;
  return resolveTransactionCommand(question, body, true) || education(question);
}
