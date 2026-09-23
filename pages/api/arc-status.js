import { enforceRateLimit } from "../../lib/api-security";
import {
  ARC_ACTIVE_NETWORK_CONFIG,
  ARC_MAINNET_READY,
  ARC_NETWORK_MODE,
  ARC_USDC_ERC20_ADDRESS,
  ARC_APP_KIT_READY,
  arcActiveChain
} from "../../lib/arc-chain";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!enforceRateLimit(req, res, { scope: "arc-status", limit: 60 })) return;
  const startedAt = Date.now();
  const base = {
    network: arcActiveChain.name,
    mode: ARC_NETWORK_MODE,
    expectedChainId: arcActiveChain.id,
    configurationReady: ARC_MAINNET_READY && ARC_APP_KIT_READY,
    explorerUrl: ARC_ACTIVE_NETWORK_CONFIG.explorerUrl,
    usdcAddress: ARC_USDC_ERC20_ADDRESS,
    nativeDecimals: 18,
    appKit: "1.15.2",
    checkedAt: new Date().toISOString()
  };
  try {
    if (!base.configurationReady) throw new Error("Arc configuration is disabled or incomplete.");
    const response = await fetch(ARC_ACTIVE_NETWORK_CONFIG.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([
        { jsonrpc: "2.0", id: "chain", method: "eth_chainId", params: [] },
        { jsonrpc: "2.0", id: "block", method: "eth_getBlockByNumber", params: ["latest", false] },
        {
          jsonrpc: "2.0",
          id: "decimals",
          method: "eth_call",
          params: [{ to: ARC_USDC_ERC20_ADDRESS, data: "0x313ce567" }, "latest"]
        }
      ]),
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error(`Arc RPC returned ${response.status}.`);
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error("Unexpected Arc RPC response.");
    const read = (id) => {
      const item = payload.find((row) => row.id === id);
      if (!item || item.error || item.result == null) throw new Error(`Arc ${id} check failed.`);
      return item.result;
    };
    const chainId = Number(read("chain"));
    const block = read("block");
    const usdcDecimals = Number(read("decimals"));
    const blockAgeSeconds = Math.floor(Date.now() / 1000) - Number(block.timestamp);
    const ok =
      chainId === arcActiveChain.id &&
      usdcDecimals === 6 &&
      Number(block.number) > 0 &&
      blockAgeSeconds >= -30 &&
      blockAgeSeconds < 180;
    res.setHeader(
      "Cache-Control",
      ok ? "public, s-maxage=20, stale-while-revalidate=20" : "no-store"
    );
    return res.status(ok ? 200 : 503).json({
      ...base,
      ok,
      chainId,
      blockNumber: Number(block.number),
      blockAgeSeconds,
      usdcDecimals,
      latencyMs: Date.now() - startedAt,
      ...(ok
        ? {}
        : {
            error:
              "Chain ID, block freshness, or USDC decimals did not match the configured Arc network."
          })
    });
  } catch (error) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(503).json({
      ...base,
      ok: false,
      error: error.message || "Arc RPC unavailable",
      latencyMs: Date.now() - startedAt
    });
  }
}
