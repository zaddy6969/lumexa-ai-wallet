import { Interface, JsonRpcProvider, ZeroAddress, formatUnits, getAddress } from "ethers";
import {
  ARC_MAINNET_REQUESTED,
  ARC_MAINNET_READY,
  ARC_USDC_ERC20_ADDRESS,
  arcTestnet
} from "./arc-chain";

let provider;

const usdcInterface = new Interface([
  "event Transfer(address indexed from, address indexed to, uint256 value)"
]);

const RECENT_RPC_LOOKBACK_BLOCKS = 2500;
const RPC_LOG_CHUNK_SIZE = 2500;
const EXPLORER_MAX_PAGES = 3;
const EXPLORER_REQUEST_TIMEOUT_MS = 7000;
const ACTIVITY_HARD_LIMIT = 100;
const USDC_DECIMALS = 6;
const NATIVE_USDC_DECIMALS = 18;
const IS_DEVELOPMENT = process.env.NODE_ENV !== "production";
const ARC_NETWORK_LABEL = arcTestnet.name || "Arc";

function getArcRpcUrl() {
  const rpcUrl = arcTestnet?.rpcUrls?.default?.http?.[0] || "";
  if (ARC_MAINNET_REQUESTED && !ARC_MAINNET_READY) {
    throw new Error(
      "Arc Mainnet activity is locked until the official mainnet configuration is complete and enabled."
    );
  }
  if (!rpcUrl) throw new Error(`${ARC_NETWORK_LABEL} RPC is not configured.`);
  return rpcUrl;
}

function getProvider() {
  if (!provider)
    provider = new JsonRpcProvider(getArcRpcUrl(), arcTestnet.id, { staticNetwork: true });
  return provider;
}

function normalizeAddress(value) {
  try {
    return value ? getAddress(value) : "";
  } catch {
    return "";
  }
}

function entityAddress(value) {
  if (!value) return "";
  if (typeof value === "string") return normalizeAddress(value);
  return normalizeAddress(value.hash || value.address_hash || value.address || "");
}

function entityName(value) {
  if (!value || typeof value === "string") return "";
  return value.name || value.implementation_name || value.metadata?.name || "";
}

function addressToTopic(address) {
  return `0x000000000000000000000000${address.slice(2).toLowerCase()}`;
}

function shortAddress(value) {
  return value ? `${value.slice(0, 6)}...${value.slice(-4)}` : "unknown";
}

function shortHash(value) {
  return value ? `${value.slice(0, 10)}...${value.slice(-6)}` : "";
}

function formatAmount(value, decimals) {
  try {
    const [whole = "0", fractional = ""] = formatUnits(value, decimals).split(".");
    const wholeWithCommas = BigInt(whole || "0").toLocaleString();
    const trimmed = fractional.replace(/0+$/, "").slice(0, 6);
    return trimmed ? `${wholeWithCommas}.${trimmed}` : `${wholeWithCommas}.00`;
  } catch {
    return "0.00";
  }
}

function relativeTime(timestampMs) {
  if (!timestampMs) return "Recently";
  const diffSeconds = Math.round((timestampMs - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, seconds] of [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60]
  ]) {
    if (Math.abs(diffSeconds) >= seconds || unit === "minute") {
      return formatter.format(Math.round(diffSeconds / seconds), unit);
    }
  }
  return "just now";
}

function explorerBase() {
  return String(arcTestnet?.blockExplorers?.default?.url || "").replace(/\/$/, "");
}

function explorerTxUrl(txHash) {
  const base = explorerBase();
  return base && txHash ? `${base}/tx/${txHash}` : "";
}

function transactionHash(transaction) {
  return transaction?.hash || transaction?.transaction_hash || "";
}

function transferHash(transfer) {
  return (
    transfer?.transaction_hash || transfer?.transaction?.hash || transfer?.transactionHash || ""
  );
}

function transferToken(transfer) {
  const token = transfer?.token || {};
  return {
    symbol: token.symbol || "TOKEN",
    name: token.name || token.symbol || "Token",
    address: token.address_hash || token.address || "",
    decimals: Number(transfer?.total?.decimals ?? token.decimals ?? 18)
  };
}

function transferRawValue(transfer) {
  return transfer?.total?.value ?? transfer?.value ?? "0";
}

function transferAmountValue(transfer) {
  const token = transferToken(transfer);
  try {
    return Number(formatUnits(BigInt(String(transferRawValue(transfer))), token.decimals));
  } catch {
    return 0;
  }
}

function transferAmountLabel(transfer) {
  const token = transferToken(transfer);
  try {
    return `${formatAmount(BigInt(String(transferRawValue(transfer))), token.decimals)} ${token.symbol}`;
  } catch {
    return `0.00 ${token.symbol}`;
  }
}

function normalizedMethod(transaction, transfers = []) {
  return String(
    transaction?.method ||
      transaction?.decoded_input?.method_call ||
      transfers.find((item) => item?.method)?.method ||
      ""
  ).toLowerCase();
}

function isZeroAddress(value) {
  return Boolean(value && value.toLowerCase() === ZeroAddress.toLowerCase());
}

function isBridgeMethod(method) {
  return [
    "bridge",
    "depositforburn",
    "deposit_for_burn",
    "burn",
    "receivemessage",
    "receive_message",
    "gatewaymint",
    "mint",
    "tokenmessenger",
    "messagetransmitter",
    "forward"
  ].some((needle) => method.includes(needle));
}

function isSwapMethod(method) {
  return ["swap", "exacttokensfortokens", "exactinput", "exactoutput"].some((needle) =>
    method.includes(needle)
  );
}

function statusFromTransaction(transaction) {
  const status = String(transaction?.status ?? transaction?.txreceipt_status ?? "").toLowerCase();
  if (["error", "failed", "0", "false", "reverted"].includes(status)) return "Failed";
  if (["ok", "success", "successful", "confirmed", "1", "true"].includes(status))
    return "Confirmed";
  return "Unknown";
}

function timestampFrom(transaction, transfers = []) {
  const value =
    transaction?.timestamp || transfers.find((item) => item?.timestamp)?.timestamp || "";
  return Date.parse(value) || 0;
}

function nativeValue(transaction) {
  try {
    return BigInt(String(transaction?.value || "0"));
  } catch {
    return 0n;
  }
}

function debug(event, detail) {
  if (IS_DEVELOPMENT) console.info("[arc-wallet-activity]", event, detail);
}

function mapExplorerHistoryItem(transaction, transfers, walletAddress) {
  const hash = transactionHash(transaction) || transferHash(transfers[0]);
  if (!hash) return null;

  const wallet = walletAddress.toLowerCase();
  const from = entityAddress(transaction?.from) || entityAddress(transfers[0]?.from);
  const to = entityAddress(transaction?.to) || entityAddress(transfers[0]?.to);
  const outgoing = transfers.filter((item) => entityAddress(item?.from).toLowerCase() === wallet);
  const incoming = transfers.filter((item) => entityAddress(item?.to).toLowerCase() === wallet);
  const method = normalizedMethod(transaction, transfers);
  const timestampMs = timestampFrom(transaction, transfers);
  const blockNumber = Number(
    transaction?.block_number || transaction?.blockNumber || transfers[0]?.block_number || 0
  );
  const status = statusFromTransaction(transaction);
  const createdContract = entityAddress(transaction?.created_contract);
  const targetName = entityName(transaction?.to) || entityName(transaction?.created_contract);

  const outgoingTokens = new Set(outgoing.map((item) => transferToken(item).symbol));
  const incomingTokens = new Set(incoming.map((item) => transferToken(item).symbol));
  const tokenChanged =
    [...outgoingTokens].some((symbol) => !incomingTokens.has(symbol)) ||
    [...incomingTokens].some((symbol) => !outgoingTokens.has(symbol));
  const zeroBurn = outgoing.some((item) => isZeroAddress(entityAddress(item?.to)));
  const zeroMint = incoming.some((item) => isZeroAddress(entityAddress(item?.from)));

  let kind = "contract";
  let type = "Contract interaction";
  let amount = "";
  let token = "";
  let counterparty = to || from || "";
  let summary = `Onchain contract interaction on ${ARC_NETWORK_LABEL}`;
  let operation = "contract";

  if ((outgoing.length && incoming.length && tokenChanged) || isSwapMethod(method)) {
    const paid = outgoing[0];
    const received = incoming[0];
    kind = "swap";
    type = "Swap";
    operation = "swap";
    amount = `${paid ? transferAmountLabel(paid) : "Token"} → ${received ? transferAmountLabel(received) : "Token"}`;
    token = transferToken(paid || received || {}).symbol;
    counterparty = to || "Arc liquidity";
    summary = `Swapped assets${method ? ` via ${method.split("(")[0]}` : ""} on ${ARC_NETWORK_LABEL}`;
  } else if (isBridgeMethod(method) || zeroBurn || zeroMint) {
    const moved = outgoing[0] || incoming[0];
    kind = zeroMint ? "bridge_received" : "bridge";
    type = zeroMint ? "Bridge received" : "Bridge";
    operation = "bridge";
    amount = moved ? transferAmountLabel(moved) : "Tracked";
    token = moved ? transferToken(moved).symbol : "USDC";
    counterparty = to || from || "Circle bridge";
    summary = zeroMint
      ? `Bridged ${token} landed on ${ARC_NETWORK_LABEL}`
      : `Cross-chain bridge transaction on ${ARC_NETWORK_LABEL}`;
  } else if (outgoing.length) {
    const moved = outgoing[0];
    const info = transferToken(moved);
    kind = "sent";
    type = `Sent ${info.symbol}`;
    operation = "send";
    amount = transferAmountLabel(moved);
    token = info.symbol;
    counterparty = entityAddress(moved?.to);
    summary = `Sent ${amount} to ${shortAddress(counterparty)}`;
  } else if (incoming.length) {
    const moved = incoming[0];
    const info = transferToken(moved);
    kind = "received";
    type = `Received ${info.symbol}`;
    operation = "receive";
    amount = transferAmountLabel(moved);
    token = info.symbol;
    counterparty = entityAddress(moved?.from);
    summary = `Received ${amount} from ${shortAddress(counterparty)}`;
  } else if (createdContract) {
    kind = "contract";
    type = "Contract deployed";
    operation = "contract_deploy";
    counterparty = createdContract;
    summary = `Deployed ${targetName || "contract"} at ${shortAddress(createdContract)}`;
  } else if (nativeValue(transaction) > 0n) {
    const sentByWallet = from.toLowerCase() === wallet;
    kind = sentByWallet ? "sent" : "received";
    type = sentByWallet ? "Sent USDC" : "Received USDC";
    operation = sentByWallet ? "send" : "receive";
    amount = `${formatAmount(nativeValue(transaction), NATIVE_USDC_DECIMALS)} USDC`;
    token = "USDC";
    counterparty = sentByWallet ? to : from;
    summary = sentByWallet
      ? `Sent ${amount} to ${shortAddress(counterparty)}`
      : `Received ${amount} from ${shortAddress(counterparty)}`;
  } else {
    const methodLabel = String(transaction?.method || "").trim();
    summary = methodLabel
      ? `${methodLabel} on ${targetName || shortAddress(to) || ARC_NETWORK_LABEL}`
      : `Onchain interaction with ${targetName || shortAddress(to) || "Arc contract"}`;
  }

  return {
    id: `explorer-${hash}`,
    type,
    kind,
    token,
    amount,
    amountValue: outgoing[0]
      ? transferAmountValue(outgoing[0])
      : incoming[0]
        ? transferAmountValue(incoming[0])
        : 0,
    chain: ARC_NETWORK_LABEL,
    chainId: arcTestnet.id,
    blockNumber,
    timeLabel: relativeTime(timestampMs),
    txHash: hash,
    txHashShort: shortHash(hash),
    summary,
    from,
    to,
    counterparty,
    explorerUrl: explorerTxUrl(hash),
    status,
    timestampMs,
    metadata: {
      operation,
      method: transaction?.method || transfers[0]?.method || "",
      contractName: targetName || "",
      contractAddress: createdContract || to || "",
      source: "arc-explorer-recent",
      transferCount: transfers.length
    }
  };
}

async function fetchExplorerPages(path, initialParams = {}) {
  const base = explorerBase();
  if (!base) return [];

  const allItems = [];
  let cursor = {};

  for (let page = 0; page < EXPLORER_MAX_PAGES; page += 1) {
    const url = new URL(`${base}${path}`);
    for (const [key, value] of Object.entries({ ...initialParams, ...cursor })) {
      if (value !== undefined && value !== null && value !== "")
        url.searchParams.set(key, String(value));
    }

    const response = await fetch(url, {
      signal: AbortSignal.timeout(EXPLORER_REQUEST_TIMEOUT_MS),
      headers: { accept: "application/json" }
    });
    if (!response.ok) throw new Error(`Arc explorer returned ${response.status}`);

    const payload = await response.json();
    const pageItems = Array.isArray(payload?.items) ? payload.items : [];
    allItems.push(...pageItems);

    const next = payload?.next_page_params;
    if (!next || typeof next !== "object" || !Object.keys(next).length || !pageItems.length) break;
    cursor = next;
  }

  return allItems;
}

async function getExplorerFullHistory(walletAddress) {
  const encoded = encodeURIComponent(walletAddress);
  const [transactions, tokenTransfers] = await Promise.all([
    fetchExplorerPages(`/api/v2/addresses/${encoded}/transactions`),
    fetchExplorerPages(`/api/v2/addresses/${encoded}/token-transfers`, { type: "ERC-20" })
  ]);

  const txByHash = new Map();
  for (const transaction of transactions) {
    const hash = transactionHash(transaction);
    if (hash) txByHash.set(hash.toLowerCase(), transaction);
  }

  const transfersByHash = new Map();
  for (const transfer of tokenTransfers) {
    const hash = transferHash(transfer);
    if (!hash) continue;
    const key = hash.toLowerCase();
    if (!transfersByHash.has(key)) transfersByHash.set(key, []);
    transfersByHash.get(key).push(transfer);
  }

  const hashes = new Set([...txByHash.keys(), ...transfersByHash.keys()]);
  const rows = [...hashes]
    .map((hash) =>
      mapExplorerHistoryItem(txByHash.get(hash), transfersByHash.get(hash) || [], walletAddress)
    )
    .filter(Boolean);

  debug("explorer-full-history", {
    walletAddress,
    transactionCount: transactions.length,
    tokenTransferCount: tokenTransfers.length,
    mergedCount: rows.length
  });

  return rows;
}

async function getLogsInChunks({ address, topics, fromBlock, toBlock }) {
  const logs = [];
  for (let start = fromBlock; start <= toBlock; start += RPC_LOG_CHUNK_SIZE) {
    const end = Math.min(start + RPC_LOG_CHUNK_SIZE - 1, toBlock);
    logs.push(
      ...(await getProvider().getLogs({ address, topics, fromBlock: start, toBlock: end }))
    );
  }
  return logs;
}

async function blockTimestampMs(blockNumber, cache) {
  if (!cache.has(blockNumber)) {
    cache.set(
      blockNumber,
      getProvider()
        .getBlock(blockNumber)
        .then((block) => Number(block?.timestamp || 0) * 1000)
        .catch(() => 0)
    );
  }
  return cache.get(blockNumber);
}

async function mapRecentTransferLog(log, walletAddress, blockCache) {
  const parsed = usdcInterface.parseLog(log);
  const from = normalizeAddress(parsed.args.from);
  const to = normalizeAddress(parsed.args.to);
  const blockNumber = Number(log.blockNumber);
  const timestampMs = await blockTimestampMs(blockNumber, blockCache);
  const sent = from === walletAddress;
  const received = to === walletAddress;
  const minted = received && from === ZeroAddress;
  const amount = `${formatAmount(parsed.args.value, USDC_DECIMALS)} USDC`;

  let type = "USDC transfer";
  let kind = "other";
  let summary = `USDC moved on ${ARC_NETWORK_LABEL}`;
  let counterparty = "";

  if (minted) {
    type = "Bridge received";
    kind = "bridge_received";
    summary = `Bridged USDC landed on ${ARC_NETWORK_LABEL}`;
  } else if (sent && received) {
    type = "Internal transfer";
    kind = "internal";
    summary = "Moved USDC within this wallet";
  } else if (received) {
    type = "Received USDC";
    kind = "received";
    counterparty = from;
    summary = `Received from ${shortAddress(from)}`;
  } else if (sent) {
    type = "Sent USDC";
    kind = "sent";
    counterparty = to;
    summary = `Sent to ${shortAddress(to)}`;
  }

  return {
    id: `rpc-${log.transactionHash}:${log.index}`,
    type,
    kind,
    token: "USDC",
    amount,
    amountValue: Number(formatUnits(parsed.args.value, USDC_DECIMALS)),
    chain: ARC_NETWORK_LABEL,
    chainId: arcTestnet.id,
    blockNumber,
    timeLabel: relativeTime(timestampMs),
    txHash: log.transactionHash,
    txHashShort: shortHash(log.transactionHash),
    summary,
    from,
    to,
    counterparty,
    explorerUrl: explorerTxUrl(log.transactionHash),
    status: "Confirmed",
    timestampMs,
    metadata: { operation: kind, source: "arc-rpc-recent" }
  };
}

async function getRecentRpcTransfers(walletAddress) {
  const currentBlock = await getProvider().getBlockNumber();
  const fromBlock = Math.max(currentBlock - (RECENT_RPC_LOOKBACK_BLOCKS - 1), 0);
  const userTopic = addressToTopic(walletAddress);
  const eventTopic = usdcInterface.getEvent("Transfer").topicHash;
  const blockCache = new Map();

  const [incoming, outgoing] = await Promise.all([
    getLogsInChunks({
      address: ARC_USDC_ERC20_ADDRESS,
      topics: [eventTopic, null, userTopic],
      fromBlock,
      toBlock: currentBlock
    }),
    getLogsInChunks({
      address: ARC_USDC_ERC20_ADDRESS,
      topics: [eventTopic, userTopic],
      fromBlock,
      toBlock: currentBlock
    })
  ]);

  const deduped = new Map();
  for (const log of [...incoming, ...outgoing])
    deduped.set(`${log.transactionHash}:${log.index}`, log);
  return Promise.all(
    [...deduped.values()].map((log) => mapRecentTransferLog(log, walletAddress, blockCache))
  );
}

function sortActivity(rows, limit) {
  const byHash = new Map();
  for (const item of rows) {
    const key = String(item.txHash || item.id).toLowerCase();
    if (!byHash.has(key)) byHash.set(key, item);
  }
  return [...byHash.values()]
    .sort((left, right) => {
      if (right.timestampMs !== left.timestampMs) return right.timestampMs - left.timestampMs;
      return right.blockNumber - left.blockNumber;
    })
    .slice(0, limit);
}

export async function getWalletActivity(address, { limit = 50 } = {}) {
  const walletAddress = normalizeAddress(address);
  if (!walletAddress) throw new Error("Invalid wallet address.");
  const requestedLimit = Math.min(Math.max(Number(limit) || 50, 1), ACTIVITY_HARD_LIMIT);
  let explorerError = null;

  try {
    const explorerRows = await getExplorerFullHistory(walletAddress);
    if (explorerRows.length) return sortActivity(explorerRows, requestedLimit);
  } catch (error) {
    explorerError = error;
  }

  try {
    const rpcRows = await getRecentRpcTransfers(walletAddress);
    if (!rpcRows.length && explorerError) throw explorerError;
    return sortActivity(rpcRows, requestedLimit);
  } catch (rpcError) {
    throw explorerError || rpcError || new Error("Activity unavailable.");
  }
}

export async function getTransactionStatus(txHash) {
  const receipt = await getProvider().getTransactionReceipt(txHash);
  if (!receipt) return { status: "Pending", blockNumber: null };
  return {
    status: receipt.status === 1 ? "Confirmed" : "Failed",
    blockNumber: Number(receipt.blockNumber || 0)
  };
}
