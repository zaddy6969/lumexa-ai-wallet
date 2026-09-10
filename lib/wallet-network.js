export function chainIdHex(chainId) {
  return `0x${Number(chainId).toString(16)}`;
}

function normalizeChainId(value) {
  if (typeof value === "string") return Number.parseInt(value, 16);
  return Number(value);
}

function isUnknownChainError(error) {
  const code = Number(error?.code || error?.cause?.code || 0);
  const message = String(error?.message || error?.cause?.message || "").toLowerCase();
  return (
    code === 4902 ||
    message.includes("unknown chain") ||
    message.includes("unrecognized chain") ||
    message.includes("not added")
  );
}

function isRejectedError(error) {
  const code = Number(error?.code || error?.cause?.code || 0);
  const message = String(error?.message || error?.cause?.message || "").toLowerCase();
  return (
    code === 4001 ||
    message.includes("reject") ||
    message.includes("denied") ||
    message.includes("cancelled") ||
    message.includes("canceled")
  );
}

function sleep(ms) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

export async function readWalletChainId(provider) {
  if (!provider?.request) return null;
  const value = await provider.request({ method: "eth_chainId" });
  const chainId = normalizeChainId(value);
  return Number.isFinite(chainId) ? chainId : null;
}

export async function waitForWalletChain(provider, expectedChainId, attempts = 14) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const activeChainId = await readWalletChainId(provider).catch(() => null);
    if (activeChainId === Number(expectedChainId)) return true;
    await sleep(220 + Math.min(attempt, 8) * 90);
  }
  return false;
}

async function addChain(provider, chain) {
  const rpcUrls = chain?.rpcUrls?.default?.http?.filter(Boolean) || [];
  if (!rpcUrls.length)
    throw new Error(`No RPC URL configured for ${chain?.name || "this network"}.`);

  await provider.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: chainIdHex(chain.id),
        chainName: chain.name,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls,
        blockExplorerUrls: chain?.blockExplorers?.default?.url
          ? [chain.blockExplorers.default.url]
          : []
      }
    ]
  });
}

export async function switchWalletNetwork({ connector, chain, switchChainAsync }) {
  if (!connector?.getProvider) throw new Error("Wallet connector is unavailable.");
  if (!chain?.id) throw new Error("The selected network is not configured.");

  const provider = await connector.getProvider();
  if (!provider?.request) throw new Error("Wallet provider is unavailable.");

  const current = await readWalletChainId(provider).catch(() => null);
  if (current === Number(chain.id)) return { provider, chainId: Number(chain.id) };

  let wagmiError = null;
  if (typeof switchChainAsync === "function") {
    try {
      await switchChainAsync({ chainId: Number(chain.id) });
    } catch (error) {
      wagmiError = error;
      if (isRejectedError(error)) throw error;
    }
  }

  let switched = await waitForWalletChain(provider, chain.id, 5);
  if (!switched) {
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainIdHex(chain.id) }]
      });
    } catch (error) {
      if (isRejectedError(error)) throw error;
      if (!isUnknownChainError(error) && !isUnknownChainError(wagmiError)) throw error;
      await addChain(provider, chain);
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainIdHex(chain.id) }]
      });
    }
    switched = await waitForWalletChain(provider, chain.id);
  }

  if (!switched) {
    throw new Error(`Wallet stayed on the previous network instead of switching to ${chain.name}.`);
  }

  // Some injected providers change successfully but their React connector state updates late.
  // Dispatch a standard provider event so Wagmi/RainbowKit consumers refresh immediately.
  try {
    if (typeof provider.emit === "function") provider.emit("chainChanged", chainIdHex(chain.id));
  } catch {}

  return { provider, chainId: Number(chain.id) };
}

export function formatNetworkSwitchError(error) {
  if (isRejectedError(error)) return "Network switch cancelled in your wallet.";
  const message = error instanceof Error ? error.message : String(error || "");
  if (/previous network|stayed on/i.test(message)) return message;
  if (/rpc url/i.test(message)) return message;
  return "Could not switch the connected wallet to that network.";
}
