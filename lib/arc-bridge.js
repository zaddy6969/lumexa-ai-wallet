import {
  APP_KIT_EVM_CHAIN_OPTIONS,
  ARC_APP_KIT_READY,
  ARC_BRIDGE_DESTINATION,
  ARC_BRIDGE_SOURCE_OPTIONS,
  ARC_MAINNET_REQUESTED
} from "./arc-chain";

const BRIDGE_SOURCE_BY_ID = new Map(ARC_BRIDGE_SOURCE_OPTIONS.map((option) => [option.id, option]));

export function getBridgeSourceOption(chainId) {
  return BRIDGE_SOURCE_BY_ID.get(chainId) || ARC_BRIDGE_SOURCE_OPTIONS[0];
}

export function getBridgeSourceOptions() {
  return ARC_BRIDGE_SOURCE_OPTIONS;
}

export function getBridgeDestination() {
  return ARC_BRIDGE_DESTINATION;
}

export function formatBridgeError(error) {
  const message = error instanceof Error ? error.message : "Unable to complete the bridge.";
  const normalized = message.toLowerCase();

  if (
    normalized.includes("user rejected") ||
    normalized.includes("user denied") ||
    normalized.includes("rejected the request")
  ) {
    return "Bridge cancelled in your wallet.";
  }
  if (
    normalized.includes("connector not connected") ||
    normalized.includes("connect your wallet")
  ) {
    return "Connect your wallet before bridging.";
  }
  if (
    normalized.includes("did not switch") ||
    normalized.includes("switchchain") ||
    normalized.includes("source network")
  ) {
    return "Your wallet could not switch to the selected source network. Switch the network in the top bar and try again.";
  }
  if (normalized.includes("insufficient")) {
    return "Not enough USDC or source-chain gas for this bridge.";
  }
  if (normalized.includes("allowance") || normalized.includes("approve")) {
    return "USDC approval could not be completed. Confirm the approval in your wallet and try again.";
  }
  if (
    normalized.includes("invalid") ||
    normalized.includes("validation") ||
    normalized.includes("unsupported") ||
    normalized.includes("route")
  ) {
    return "This bridge route is not currently available for the selected network or amount.";
  }
  return message || "Bridge failed. Please try again.";
}

export function getBridgeErrorDetail(error) {
  if (!error) return "";
  return error instanceof Error ? error.message : String(error);
}

export function summarizeBridgeFees(estimate) {
  if (!estimate) return [];
  const gasFees = Array.isArray(estimate.gasFees) ? estimate.gasFees : [];
  const protocolFees = Array.isArray(estimate.fees) ? estimate.fees : [];
  return [
    ...gasFees.map((fee) => ({
      label: fee.name || `${fee.blockchain || "Network"} fee`,
      value: fee.fees?.formatted || fee.fees?.amount || "Included",
      tone: fee.error ? "amber" : "blue"
    })),
    ...protocolFees.map((fee) => ({
      label: fee.type ? `${fee.type} fee` : "Bridge fee",
      value: fee.amount ? `${fee.amount} ${fee.token || ""}`.trim() : "Included",
      tone: fee.error ? "amber" : "violet"
    }))
  ];
}

export function normalizeBridgeSteps(result) {
  if (!result || !Array.isArray(result.steps)) return [];
  return result.steps.map((step, index) => ({
    id: `${step.name || "step"}-${index}`,
    name: step.name || `Step ${index + 1}`,
    state: step.state || "pending",
    txHash: step.txHash || "",
    explorerUrl: step.explorerUrl || ""
  }));
}

function getStaticChainLookup(chainModule) {
  return Object.fromEntries(
    APP_KIT_EVM_CHAIN_OPTIONS.filter((option) => option.appKitChain).map((option) => [
      option.appKitChain,
      option.appKitModuleKey ? chainModule[option.appKitModuleKey] || null : null
    ])
  );
}

function getBridgeChainLookup(appKit, chainModule) {
  const lookup = getStaticChainLookup(chainModule);
  try {
    const supported = appKit?.getSupportedChains?.("bridge");
    if (Array.isArray(supported)) {
      supported.forEach((definition) => {
        if (definition?.chain) lookup[definition.chain] = definition;
      });
    }
  } catch {
    // Older App Kit builds can still bridge with their exported chain definitions.
  }
  return lookup;
}

function buildBridgeDestination({ adapter, chainLookup, to }) {
  if (!to?.chain || !to?.recipientAddress) return to;
  const destinationDefinition = chainLookup[to.chain];
  const useForwarder = Boolean(destinationDefinition?.cctp?.forwarderSupported?.destination);

  if (useForwarder) {
    return {
      chain: to.chain,
      recipientAddress: to.recipientAddress,
      useForwarder: true
    };
  }

  return {
    adapter,
    chain: to.chain,
    recipientAddress: to.recipientAddress
  };
}

function normalizeBridgeParams(params, adapter, chainLookup) {
  return {
    ...params,
    token: params?.token || "USDC",
    to: buildBridgeDestination({ adapter, chainLookup, to: params?.to })
  };
}

export async function createArcBridgeClient(provider) {
  if (!provider?.request) throw new Error("Wallet provider is unavailable.");
  if (ARC_MAINNET_REQUESTED && !ARC_APP_KIT_READY) {
    throw new Error(
      "Arc Mainnet bridge support is locked until official production App Kit chain identifiers are configured."
    );
  }

  const [{ AppKit }, { createViemAdapterFromProvider }, chainModule] = await Promise.all([
    import("@circle-fin/app-kit"),
    import("@circle-fin/adapter-viem-v2"),
    import("@circle-fin/app-kit/chains")
  ]);

  // Circle's browser examples construct the EVM adapter directly from the
  // connected wallet provider. Keep this path simple and let App Kit own the
  // bridge-specific chain/forwarder behavior.
  const adapter = await createViemAdapterFromProvider({ provider });
  const appKit = new AppKit();
  const chainLookup = getBridgeChainLookup(appKit, chainModule);

  return {
    adapter,
    chainLookup,
    kit: {
      estimateBridge: (params) =>
        appKit.estimateBridge(normalizeBridgeParams(params, adapter, chainLookup)),
      bridge: (params) => appKit.bridge(normalizeBridgeParams(params, adapter, chainLookup)),
      retryBridge: typeof appKit.retryBridge === "function" ? appKit.retryBridge.bind(appKit) : null
    }
  };
}
