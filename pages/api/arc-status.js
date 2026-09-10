import { enforceRateLimit } from "../../lib/api-security";

const mode =
  String(
    process.env.ARC_NETWORK || process.env.NEXT_PUBLIC_ARC_NETWORK || "testnet"
  ).toLowerCase() === "mainnet"
    ? "mainnet"
    : "testnet";
const mainnetRequested = mode === "mainnet";
const expectedChainId = mainnetRequested ? 5042 : 5042002;
const networkName = mainnetRequested ? "Arc Mainnet" : "Arc Testnet";
const mainnetEnabled =
  String(process.env.NEXT_PUBLIC_ARC_MAINNET_ENABLED || "false").toLowerCase() === "true";
const ARC_RPC_URL = mainnetRequested
  ? process.env.ARC_MAINNET_RPC_URL || process.env.NEXT_PUBLIC_ARC_MAINNET_RPC_URL || ""
  : process.env.ARC_TESTNET_RPC_URL ||
    process.env.ARC_RPC_URL ||
    process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL ||
    process.env.NEXT_PUBLIC_ARC_RPC_URL ||
    "https://rpc.testnet.arc.network";

async function rpc(method, params = []) {
  if (!ARC_RPC_URL) {
    throw new Error("Arc Mainnet RPC is not configured.");
  }

  const response = await fetch(ARC_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params }),
    signal: AbortSignal.timeout(6000)
  });

  if (!response.ok) throw new Error(`Arc RPC returned ${response.status}`);
  const payload = await response.json();
  if (payload?.error) throw new Error(payload.error.message || `${method} failed`);
  return payload?.result;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!enforceRateLimit(req, res, { scope: "arc-status", limit: 60 })) return;

  const startedAt = Date.now();

  if (mainnetRequested && (!ARC_RPC_URL || !mainnetEnabled)) {
    return res.status(503).json({
      ok: false,
      network: networkName,
      mode,
      expectedChainId,
      configurationReady: false,
      mainnetEnabled,
      launchDate: "2026-09-16",
      error: !ARC_RPC_URL
        ? "Arc Mainnet RPC is not configured."
        : "Arc Mainnet is configured but still locked by NEXT_PUBLIC_ARC_MAINNET_ENABLED.",
      checkedAt: new Date().toISOString()
    });
  }

  try {
    const [chainIdHex, blockHex] = await Promise.all([rpc("eth_chainId"), rpc("eth_blockNumber")]);

    const chainId = Number.parseInt(chainIdHex, 16);
    const blockNumber = Number.parseInt(blockHex, 16);
    const chainMatches = chainId === expectedChainId;

    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
    return res.status(chainMatches ? 200 : 503).json({
      ok: chainMatches,
      network: networkName,
      mode,
      expectedChainId,
      chainId,
      blockNumber,
      configurationReady: true,
      mainnetEnabled: mainnetRequested ? mainnetEnabled : undefined,
      launchDate: mainnetRequested ? "2026-09-16" : undefined,
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
      rpc:
        !mainnetRequested && ARC_RPC_URL === "https://rpc.testnet.arc.network"
          ? "official"
          : "configured",
      ...(chainMatches
        ? {}
        : { error: `Wrong network: expected chain ID ${expectedChainId}, received ${chainId}.` })
    });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      network: networkName,
      mode,
      expectedChainId,
      configurationReady: Boolean(ARC_RPC_URL),
      mainnetEnabled: mainnetRequested ? mainnetEnabled : undefined,
      launchDate: mainnetRequested ? "2026-09-16" : undefined,
      error: error instanceof Error ? error.message : "Arc RPC unavailable",
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString()
    });
  }
}
