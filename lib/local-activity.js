import { useCallback, useEffect, useMemo, useState } from "react";
import { ARC_NETWORK_MODE, arcActiveChain } from "./arc-chain.js";

const STORAGE_KEY = `lumexa-ai-wallet:activity:v3:${ARC_NETWORK_MODE}`;
const LEGACY_STORAGE_KEYS = arcActiveChain.testnet
  ? [
      "lumexa-ai-wallet:activity:v2",
      "lumexa-ai-wallet:activity:v1",
      "lumexa-ai-wallet:activity",
      "arc-ai-wallet:activity"
    ]
  : [];
const UPDATE_EVENT = "lumexa-ai-wallet:activity-updated";
const IS_DEVELOPMENT = process.env.NODE_ENV !== "production";

function isBrowser() {
  return typeof window !== "undefined";
}

function normalizeAddress(address) {
  return typeof address === "string" ? address.toLowerCase() : "";
}

function debugActivityLog(event, detail) {
  if (IS_DEVELOPMENT) console.info("[wallet-activity]", event, detail);
}

function parseStoredList(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readStorage() {
  if (!isBrowser()) return [];
  try {
    const current = parseStoredList(window.localStorage.getItem(STORAGE_KEY));
    const legacy = LEGACY_STORAGE_KEYS.flatMap((key) =>
      parseStoredList(window.localStorage.getItem(key))
    );
    if (!legacy.length) return current;

    const merged = new Map();
    [...current, ...legacy].forEach((item) => {
      const txHash = String(item?.txHash || "").toLowerCase();
      const id = String(item?.id || "");
      const key = txHash
        ? `tx:${txHash}`
        : id
          ? `id:${id}`
          : `legacy:${item?.type || "activity"}:${item?.createdAt || ""}:${item?.amount || ""}`;
      if (!merged.has(key)) merged.set(key, item);
    });
    const rows = [...merged.values()].slice(0, 150);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
    return rows;
  } catch {
    return [];
  }
}

function writeStorage(items) {
  if (!isBrowser()) return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
    return true;
  } catch {
    return false;
  }
}

function replaceStoredItems(nextItems) {
  writeStorage(nextItems.slice(0, 150));
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function shortHash(hash) {
  if (!hash || hash.length < 14) return hash || "";
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
}

function getTimestamp(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getActivityKey(item) {
  if (item?.txHash)
    return `tx:${item.chainId || arcActiveChain.id}:${String(item.txHash).toLowerCase()}`;
  if (item?.id) return `id:${item.id}`;
  return `fallback:${[item?.type, item?.createdAt, item?.amount, item?.walletAddress].filter(Boolean).join(":")}`;
}

function semanticKind(item) {
  const kind = String(item?.kind || "").toLowerCase();
  const type = String(item?.type || "").toLowerCase();
  const operation = String(item?.metadata?.operation || "").toLowerCase();
  if (kind === "swap" || type.includes("swap") || operation === "swap") return "swap";
  if (
    kind === "bridge" ||
    kind === "bridge_received" ||
    type.includes("bridge") ||
    operation === "bridge"
  )
    return "bridge";
  if (kind === "sent" || type.startsWith("sent") || type.includes("send")) return "sent";
  if (kind === "received" || type.startsWith("received") || type.includes("receive"))
    return "received";
  return kind;
}

function mergeActivityItemPair(left, right) {
  const items = [left, right].filter(Boolean);
  const chainItem = items.find((item) => item.source === "chain") || null;
  const appItem = items.findLast((item) => item.source === "app") || null;
  const primary = chainItem || right || left;
  const appSemanticKind = semanticKind(appItem);
  const preserveAppMeaning = appSemanticKind === "swap" || appSemanticKind === "bridge";
  const kind = preserveAppMeaning
    ? appSemanticKind
    : semanticKind(chainItem) || semanticKind(appItem) || semanticKind(primary);

  return {
    ...primary,
    id: chainItem?.id || appItem?.id || primary.id,
    source: chainItem && appItem ? "merged" : primary.source,
    walletAddress:
      appItem?.walletAddress || chainItem?.walletAddress || primary.walletAddress || "",
    type: preserveAppMeaning
      ? appItem?.type || primary.type
      : chainItem?.type || appItem?.type || primary.type,
    kind,
    amount: preserveAppMeaning
      ? appItem?.amount || chainItem?.amount || primary.amount || ""
      : chainItem?.amount || appItem?.amount || primary.amount || "",
    chain: appItem?.chain || chainItem?.chain || primary.chain || arcActiveChain.name,
    chainId: appItem?.chainId || chainItem?.chainId || primary.chainId || null,
    sender:
      chainItem?.sender ||
      appItem?.sender ||
      chainItem?.from ||
      primary.sender ||
      primary.from ||
      "",
    receiver:
      chainItem?.receiver ||
      appItem?.receiver ||
      chainItem?.to ||
      primary.receiver ||
      primary.to ||
      "",
    recipient:
      chainItem?.recipient ||
      appItem?.recipient ||
      chainItem?.counterparty ||
      primary.recipient ||
      "",
    counterparty: chainItem?.counterparty || appItem?.recipient || primary.counterparty || "",
    status: preserveAppMeaning
      ? appItem?.status || "Pending"
      : chainItem?.status || appItem?.status || primary.status || "Unknown",
    txHash: chainItem?.txHash || appItem?.txHash || primary.txHash || "",
    txHashShort:
      chainItem?.txHashShort ||
      appItem?.txHashShort ||
      shortHash(chainItem?.txHash || appItem?.txHash || primary.txHash || ""),
    explorerUrl: chainItem?.explorerUrl || appItem?.explorerUrl || primary.explorerUrl || "",
    summary: preserveAppMeaning
      ? appItem?.summary || chainItem?.summary || primary.summary || ""
      : chainItem?.summary || appItem?.summary || primary.summary || "",
    createdAt:
      appItem?.createdAt || chainItem?.createdAt || primary.createdAt || new Date().toISOString(),
    timeLabel: chainItem?.timeLabel || appItem?.timeLabel || primary.timeLabel || "Recently",
    blockNumber: chainItem?.blockNumber || appItem?.blockNumber || primary.blockNumber || null,
    token: appItem?.token || chainItem?.token || primary.token || "USDC",
    metadata: {
      ...(chainItem?.metadata || {}),
      ...(primary.metadata || {}),
      ...(appItem?.metadata || {})
    }
  };
}

export function saveLocalActivity(item) {
  const current = readStorage();
  const normalizedItem = {
    ...item,
    walletAddress: normalizeAddress(item?.walletAddress),
    kind: semanticKind(item) || item?.kind || ""
  };
  const key = getActivityKey(normalizedItem);
  const existing = current.find((row) => getActivityKey(row) === key);
  const nextItem = existing ? mergeActivityItemPair(existing, normalizedItem) : normalizedItem;
  const withoutDuplicate = current.filter((row) => getActivityKey(row) !== key);
  debugActivityLog("local-save", {
    txHash: item?.txHash || "",
    type: item?.type || "",
    kind: nextItem.kind
  });
  writeStorage([nextItem, ...withoutDuplicate].slice(0, 150));
}

export function updateLocalActivityStatuses(statuses) {
  if (!statuses || typeof statuses !== "object") return;
  const current = readStorage();
  let changed = false;
  const nextItems = current.map((item) => {
    if (["bridge", "swap"].includes(semanticKind(item))) return item;
    const key = Object.keys(statuses).find(
      (hash) => String(hash).toLowerCase() === String(item.txHash || "").toLowerCase()
    );
    const nextStatus = key ? statuses[key]?.status : "";
    if (!nextStatus || nextStatus === item.status) return item;
    changed = true;
    return {
      ...item,
      status: nextStatus,
      blockNumber: statuses[key]?.blockNumber || item.blockNumber || null
    };
  });
  if (changed) replaceStoredItems(nextItems);
}

export function updateLocalActivityByHash(txHash, patch) {
  if (!txHash || !patch || typeof patch !== "object") return;
  const normalizedHash = String(txHash).toLowerCase();
  const current = readStorage();
  let changed = false;
  const nextItems = current.map((item) => {
    if (String(item.txHash || "").toLowerCase() !== normalizedHash) return item;
    changed = true;
    const updated = { ...item, ...patch };
    return { ...updated, kind: semanticKind(updated) || updated.kind || "" };
  });
  if (changed) replaceStoredItems(nextItems);
}

export function createWalletActionRecord({
  walletAddress,
  type,
  kind = "",
  amount,
  chain,
  chainId = arcActiveChain.id,
  token = "USDC",
  sender = "",
  receiver = "",
  recipient = "",
  status = "Pending",
  txHash = "",
  explorerUrl = "",
  summary = "",
  metadata = {}
}) {
  const createdAt = new Date().toISOString();
  const record = {
    id: `${type}-${txHash || createdAt}`,
    walletAddress: normalizeAddress(walletAddress),
    source: "app",
    type,
    kind,
    amount,
    chain,
    chainId,
    token,
    sender: normalizeAddress(sender),
    receiver: normalizeAddress(receiver || recipient),
    recipient,
    status,
    txHash,
    txHashShort: shortHash(txHash),
    explorerUrl,
    summary,
    createdAt,
    timeLabel: formatTimestamp(createdAt),
    metadata
  };
  return { ...record, kind: semanticKind(record) || kind };
}

export function mapLiveActivityToFeedItem(item) {
  return {
    id: `chain-${item.id}`,
    walletAddress: "",
    source: "chain",
    type: item.type,
    kind: semanticKind(item) || item.kind || "",
    amount: item.amount || "",
    chain: item.chain || arcActiveChain.name,
    chainId: item.chainId || null,
    sender: item.from || "",
    receiver: item.to || "",
    recipient: item.counterparty || "",
    counterparty: item.counterparty || "",
    status: item.status || "Unknown",
    txHash: item.txHash || "",
    txHashShort: item.txHashShort || shortHash(item.txHash || ""),
    explorerUrl: item.explorerUrl || "",
    summary: item.summary || "",
    createdAt: item.timestampMs ? new Date(item.timestampMs).toISOString() : "",
    timeLabel: item.timeLabel || "Recently",
    blockNumber: item.blockNumber || null,
    token: item.token || "USDC",
    metadata: item.metadata || {}
  };
}

export function mergeActivityFeedItems(localItems, liveItems) {
  const merged = new Map();
  for (const rawItem of [...localItems, ...liveItems]) {
    const item = { ...rawItem, kind: semanticKind(rawItem) || rawItem?.kind || "" };
    const key = getActivityKey(item);
    const existing = merged.get(key);
    merged.set(key, existing ? mergeActivityItemPair(existing, item) : item);
  }
  return [...merged.values()].sort(
    (left, right) => getTimestamp(right.createdAt) - getTimestamp(left.createdAt)
  );
}

export function useLocalActivityHistory(address) {
  const [items, setItems] = useState([]);

  const refresh = useCallback(() => {
    const walletAddress = normalizeAddress(address);
    const storedItems = readStorage();
    const nextItems = storedItems
      .filter((item) => walletAddress && normalizeAddress(item.walletAddress) === walletAddress)
      .map((item) => ({ ...item, kind: semanticKind(item) || item.kind || "" }));
    setItems(nextItems);
  }, [address]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) refresh();
    });
    if (!isBrowser()) return undefined;
    const handleUpdate = () => refresh();
    const handleStorage = (event) => {
      if (!event.key || event.key === STORAGE_KEY || LEGACY_STORAGE_KEYS.includes(event.key))
        refresh();
    };
    window.addEventListener(UPDATE_EVENT, handleUpdate);
    window.addEventListener("storage", handleStorage);
    return () => {
      active = false;
      window.removeEventListener(UPDATE_EVENT, handleUpdate);
      window.removeEventListener("storage", handleStorage);
    };
  }, [refresh]);

  return useMemo(
    () => ({
      items,
      save: saveLocalActivity,
      updateStatuses: updateLocalActivityStatuses,
      updateByHash: updateLocalActivityByHash,
      refresh
    }),
    [items, refresh]
  );
}
