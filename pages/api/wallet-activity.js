import { getWalletActivity } from "../../lib/wallet-activity";
import { isAddress } from "viem";
import { enforceRateLimit } from "../../lib/api-security";
import { isZeroEvmAddress } from "../../lib/wallet-validation.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }
  if (!enforceRateLimit(req, res, { scope: "activity", limit: 30 })) return;

  const { address, limit: rawLimit } = req.query || {};
  const walletAddress = typeof address === "string" ? address.trim() : "";
  const limit = Math.min(Math.max(Number.parseInt(String(rawLimit || "50"), 10) || 50, 1), 100);

  if (!walletAddress || !isAddress(walletAddress) || isZeroEvmAddress(walletAddress)) {
    return res.status(400).json({ error: "A non-zero wallet address is required." });
  }

  try {
    const activity = await getWalletActivity(walletAddress, { limit });

    if (process.env.NODE_ENV !== "production") {
      console.info("[arc-wallet-activity]", "api-response", {
        address: walletAddress,
        fetchedCount: activity.length
      });
    }

    res.setHeader("Cache-Control", "public, s-maxage=45, stale-while-revalidate=180");

    return res.status(200).json({ activity });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[arc-wallet-activity]", "api-error", {
        address: walletAddress,
        message: error instanceof Error ? error.message : "Unknown RPC error"
      });
    }

    return res.status(503).json({
      error: "Activity temporarily unavailable. Please try again later."
    });
  }
}
