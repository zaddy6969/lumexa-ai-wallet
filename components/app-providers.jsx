import { connectorsForWallets, lightTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { injectedWallet, safeWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Component, useMemo, useState } from "react";
import { createConfig, http, WagmiProvider } from "wagmi";
import {
  ARC_MAINNET_REQUESTED,
  ARC_MAINNET_READY,
  MULTICHAIN_WALLET_CHAINS,
  arcActiveChain,
  hasWalletConnectProjectId,
  walletConnectProjectId
} from "../lib/arc-chain";
import { PreparedWalletActionProvider } from "./prepared-wallet-action-provider";
import WalletLoginScreen from "./wallet-login-screen";

function ProviderFallback({ message }) {
  return (
    <WalletLoginScreen
      providerUnavailable
      providerError={
        message || "Wallet provider initialization failed, but the app is still available."
      }
    />
  );
}

class ProviderErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[lumexa-wallet-provider]", error);
    }
  }

  render() {
    if (this.state.error) {
      return (
        <ProviderFallback
          message={
            this.state.error instanceof Error
              ? this.state.error.message
              : "Unable to initialize wallet provider."
          }
        />
      );
    }

    return this.props.children;
  }
}

function createWalletConfig() {
  if (ARC_MAINNET_REQUESTED && !ARC_MAINNET_READY) {
    throw new Error(
      "Arc Mainnet mode is locked. Configure the official mainnet RPC and explorer, then explicitly enable mainnet before connecting a wallet."
    );
  }

  const chainsWithoutRpc = MULTICHAIN_WALLET_CHAINS.filter(
    (chain) => !chain?.rpcUrls?.default?.http?.[0]
  );
  if (chainsWithoutRpc.length) {
    throw new Error(
      `Missing RPC configuration for: ${chainsWithoutRpc.map((chain) => chain.name).join(", ")}.`
    );
  }

  const wallets = [injectedWallet, safeWallet];

  if (hasWalletConnectProjectId) {
    wallets.push(walletConnectWallet);
  }

  const connectors = connectorsForWallets(
    [
      {
        groupName: "Recommended",
        wallets
      }
    ],
    {
      appName: "Lumexa AI Wallet",
      ...(hasWalletConnectProjectId ? { projectId: walletConnectProjectId } : {})
    }
  );

  return createConfig({
    connectors,
    chains: MULTICHAIN_WALLET_CHAINS,
    pollingInterval: 12_000,
    ssr: true,
    transports: Object.fromEntries(
      MULTICHAIN_WALLET_CHAINS.map((chain) => [
        chain.id,
        http(chain.rpcUrls.default.http[0], {
          batch: {
            batchSize: 20,
            wait: 16
          },
          retryCount: 1,
          timeout: 10_000
        })
      ])
    )
  });
}

const rainbowTheme = lightTheme({
  accentColor: "#5568e8",
  accentColorForeground: "#ffffff",
  borderRadius: "large",
  fontStack: "system",
  overlayBlur: "small"
});

export default function AppProviders({ children }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: true,
            retry: 1,
            staleTime: 30_000
          }
        }
      })
  );
  const walletConfigState = useMemo(() => {
    try {
      return { config: createWalletConfig(), error: null };
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[lumexa-wallet-provider]", error);
      }

      return { config: null, error };
    }
  }, []);

  if (!walletConfigState.config) {
    return (
      <ProviderFallback
        message={
          walletConfigState.error instanceof Error
            ? walletConfigState.error.message
            : "Unable to initialize wallet provider."
        }
      />
    );
  }

  return (
    <ProviderErrorBoundary>
      <WagmiProvider config={walletConfigState.config}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider initialChain={arcActiveChain} theme={rainbowTheme}>
            <PreparedWalletActionProvider>{children}</PreparedWalletActionProvider>
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </ProviderErrorBoundary>
  );
}
