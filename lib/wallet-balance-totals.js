// Never combine test balances with the mainnet portfolio, even when both
// networks are available in the wallet connection UI.
export function summarizeNetworkBalances(networks, environment) {
  const ready = networks.filter((network) => network.status === "ready");
  const scoped = ready.filter(
    (network) => Boolean(network.testnet) === (environment === "testnet")
  );
  const numeric = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
  const references = scoped
    .map((network) => network.totalReferenceUsd)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  return {
    totalUsdc: scoped.reduce((sum, network) => sum + numeric(network.usdcBalance), 0),
    totalAssetCount: scoped.reduce((sum, network) => sum + numeric(network.assetCount), 0),
    totalReferenceUsd:
      environment === "testnet" || !references.length
        ? null
        : references.reduce((sum, value) => sum + value, 0),
    partial: ready.length !== networks.length
  };
}
