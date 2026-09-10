import { createPublicClient, http } from "viem";
import { MULTICHAIN_WALLET_CHAINS, arcTestnet } from "../../lib/arc-chain";
import {
  enforceRateLimit,
  hasOversizedJsonBody,
  rejectCrossSiteRequest,
  setNoStore
} from "../../lib/api-security";

const HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;

function getChain(chainId) {
  return MULTICHAIN_WALLET_CHAINS.find((chain) => chain.id === Number(chainId)) || null;
}

function normalizeRequests(body) {
  const transactions = Array.isArray(body?.transactions) ? body.transactions : [];
  if (transactions.length) {
    return transactions
      .filter((item) => item && typeof item.hash === "string" && HASH_PATTERN.test(item.hash))
      .map((item) => ({ hash: item.hash, chainId: Number(item.chainId) || arcTestnet.id }))
      .slice(0, 25);
  }

  const hashes = Array.isArray(body?.hashes) ? body.hashes : [];
  return [...new Set(hashes.filter((hash) => typeof hash === "string" && HASH_PATTERN.test(hash)))]
    .slice(0, 25)
    .map((hash) => ({ hash, chainId: arcTestnet.id }));
}

async function getStatus(item) {
  const chain = getChain(item.chainId);
  const rpcUrl = chain?.rpcUrls?.default?.http?.[0];
  if (!chain || !rpcUrl) return { status: "Pending", chainId: item.chainId, blockNumber: null };

  const client = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 8000 }) });
  try {
    const receipt = await client.getTransactionReceipt({ hash: item.hash });
    return {
      status: receipt.status === "success" ? "Confirmed" : "Failed",
      chainId: chain.id,
      blockNumber: receipt.blockNumber ? Number(receipt.blockNumber) : null
    };
  } catch {
    return { status: "Pending", chainId: chain.id, blockNumber: null };
  }
}

export default async function handler(req, res) {
  setNoStore(res);
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }
  if (!enforceRateLimit(req, res, { scope: "transaction-status", limit: 30 })) return;
  if (rejectCrossSiteRequest(req, res)) return;
  if (hasOversizedJsonBody(req, 16_000)) {
    return res.status(413).json({ error: "Request is too large." });
  }

  const transactions = normalizeRequests(req.body);
  if (!transactions.length) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ statuses: {} });
  }

  try {
    const entries = await Promise.all(
      transactions.map(async (item) => [item.hash, await getStatus(item)])
    );
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ statuses: Object.fromEntries(entries) });
  } catch {
    return res.status(503).json({ error: "Failed to load transaction status." });
  }
}
