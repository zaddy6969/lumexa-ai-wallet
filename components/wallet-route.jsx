import dynamic from "next/dynamic";
import Head from "next/head";
import { useRouter } from "next/router";
import { useCallback, useEffect, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { ARC_NETWORK_MODE, MULTICHAIN_WALLET_CHAINS, arcTestnet } from "../lib/arc-chain";
import { useArcWalletSnapshot } from "../lib/use-arc-wallet-snapshot";
import { useWalletAppState } from "../lib/use-wallet-app-state";
import { switchWalletNetwork } from "../lib/wallet-network";
import AppShell from "./app-shell";
import { usePreparedWalletAction } from "./prepared-wallet-action-provider";
import TransactionNotice from "./transaction-notice";
import WalletLoginScreen from "./wallet-login-screen";
import WalletSidebar from "./wallet-sidebar";

function PanelLoading() {
  return (
    <section className="panel panel-loading" role="status" aria-live="polite">
      <span className="loading-spinner" aria-hidden="true" />
      <div>
        <strong>Loading wallet</strong>
        <p>Syncing the latest data…</p>
      </div>
    </section>
  );
}

const WalletDashboard = dynamic(() => import("./wallet-dashboard"), { loading: PanelLoading });
const BridgePanel = dynamic(() => import("./bridge-panel"), { loading: PanelLoading });
const SendPanel = dynamic(() => import("./send-panel"), { loading: PanelLoading });
const SwapPanel = dynamic(() => import("./swap-panel"), { loading: PanelLoading });
const TransactionActivity = dynamic(() => import("./transaction-activity"), {
  loading: PanelLoading
});
const AiAgentWorkspace = dynamic(() => import("./ai-agent-workspace"), {
  ssr: false,
  loading: PanelLoading
});
const ReceiveModal = dynamic(() => import("./wallet/ReceiveModal"), { ssr: false });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://lumexa-aiwallet.vercel.app";
const VIEW_ROUTES = {
  dashboard: "/",
  send: "/send",
  swap: "/swap",
  bridge: "/bridge",
  activity: "/activity",
  agent: "/assistant"
};
const ROUTE_VIEWS = new Set(Object.keys(VIEW_ROUTES));
const PAGE_META = {
  dashboard: ["Lumexa AI Wallet", "A self-custodial USDC wallet built for Arc."],
  send: ["Send USDC | Lumexa", "Review and send USDC on Arc from your connected wallet."],
  swap: ["Swap | Lumexa", "Get a live Arc swap quote and approve it from your wallet."],
  bridge: ["Bridge USDC | Lumexa", "Bridge USDC between supported networks and Arc."],
  activity: ["Activity | Lumexa", "Review your recent Arc wallet activity."],
  agent: ["Ask Lumexa | Lumexa", "Get local-first explanations and optional AI wallet assistance."]
};

function normalizeWalletView(view) {
  if (view === "receive" || view === "request") return "receive";
  if (view === "portfolio" || view === "unified" || view === "community") return "dashboard";
  return ROUTE_VIEWS.has(view) ? view : "dashboard";
}

function copilotNetworkChainId(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "arc") return arcTestnet.id;
  if (ARC_NETWORK_MODE === "mainnet") {
    if (normalized === "ethereum" || normalized === "ethereum-mainnet") return 1;
    if (normalized === "base" || normalized === "base-mainnet") return 8453;
    return null;
  }
  if (normalized === "ethereum-sepolia") return 11155111;
  if (normalized === "base-sepolia") return 84532;
  return null;
}

function ConnectedWalletExperience({ initialView, initialReceiveOpen, walletSnapshot }) {
  const router = useRouter();
  const {
    mergedActivity,
    liveActivityStatus,
    liveActivityError,
    saveLocalActivity,
    refreshActivity,
    updateLocalActivityByHash
  } = useWalletAppState(walletSnapshot);
  const { connector } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { preparedAction, prepareAction, clearPreparedAction } = usePreparedWalletAction();
  const [copilotAction] = useState(() => preparedAction);
  const [receiveOpen, setReceiveOpen] = useState(Boolean(initialReceiveOpen));
  const [assistantPrompt, setAssistantPrompt] = useState(null);

  useEffect(() => {
    if (copilotAction?.id) clearPreparedAction(copilotAction.id);
  }, [clearPreparedAction, copilotAction]);

  useEffect(() => {
    const legacyView = String(window.location.hash || "").replace(/^#/, "");
    if (!legacyView) return;
    const normalized = normalizeWalletView(legacyView);
    void router
      .replace(normalized === "receive" ? "/receive" : VIEW_ROUTES[normalized])
      .then(() => {
        if (normalized === "receive") setReceiveOpen(true);
      });
  }, [router]);

  const selectView = useCallback(
    (requestedView) => {
      const view = normalizeWalletView(requestedView);
      clearPreparedAction();
      if (view === "receive") {
        setReceiveOpen(true);
        return;
      }
      void router.push(VIEW_ROUTES[view]);
    },
    [clearPreparedAction, router]
  );

  const openPreparedView = useCallback(
    (requestedView, action) => {
      const view = normalizeWalletView(requestedView);
      if (view === "receive") {
        setReceiveOpen(true);
        return;
      }
      prepareAction(action);
      void router.push(VIEW_ROUTES[view]);
    },
    [prepareAction, router]
  );

  const handleCopilotAction = useCallback(
    async (action) => {
      if (!action?.tool) return;
      if (action.tool === "prepare_send") return openPreparedView("send", action);
      if (action.tool === "prepare_swap") return openPreparedView("swap", action);
      if (action.tool === "prepare_bridge") return openPreparedView("bridge", action);
      if (action.tool === "open_wallet_view") return selectView(action?.args?.view);

      if (action.tool === "switch_network") {
        const chainId = copilotNetworkChainId(action?.args?.network);
        const chain = MULTICHAIN_WALLET_CHAINS.find((item) => item.id === Number(chainId));
        if (!chain || !connector) return;
        try {
          await switchWalletNetwork({ connector, chain, switchChainAsync });
        } catch {
          setAssistantPrompt({
            id: `${Date.now()}-switch-error`,
            text: "My wallet did not complete the network switch. What should I check?"
          });
          void router.push(VIEW_ROUTES.agent);
        }
      }
    },
    [connector, openPreparedView, router, selectView, switchChainAsync]
  );

  const activeView = normalizeWalletView(initialView);

  return (
    <AppShell
      walletSnapshot={walletSnapshot}
      onOpenAssistant={() => void router.push(VIEW_ROUTES.agent)}
    >
      <div className="wallet-workspace">
        <WalletSidebar
          activeView={activeView}
          onSelect={selectView}
          onReceive={() => setReceiveOpen(true)}
        />

        <div className="wallet-main" id="wallet-content">
          {activeView === "dashboard" ? (
            <WalletDashboard
              walletSnapshot={walletSnapshot}
              activityItems={mergedActivity}
              onSelectView={selectView}
              onReceive={() => setReceiveOpen(true)}
            />
          ) : activeView === "agent" ? (
            <AiAgentWorkspace
              walletSnapshot={walletSnapshot}
              activityItems={mergedActivity}
              activityStatus={liveActivityStatus}
              initialPrompt={assistantPrompt}
              onWalletAction={handleCopilotAction}
            />
          ) : activeView === "activity" ? (
            <TransactionActivity
              walletSnapshot={walletSnapshot}
              items={mergedActivity}
              liveStatus={liveActivityStatus}
              liveError={liveActivityError}
              onRefresh={refreshActivity}
            />
          ) : activeView === "swap" ? (
            <>
              <TransactionNotice mode="swap" walletSnapshot={walletSnapshot} />
              <SwapPanel
                key={copilotAction?.tool === "prepare_swap" ? copilotAction.id : "swap"}
                walletSnapshot={walletSnapshot}
                onActivitySaved={saveLocalActivity}
                copilotAction={copilotAction}
              />
            </>
          ) : activeView === "bridge" ? (
            <>
              <TransactionNotice mode="bridge" walletSnapshot={walletSnapshot} />
              <BridgePanel
                key={copilotAction?.tool === "prepare_bridge" ? copilotAction.id : "bridge"}
                walletSnapshot={walletSnapshot}
                onActivitySaved={saveLocalActivity}
                copilotAction={copilotAction}
              />
            </>
          ) : (
            <>
              <TransactionNotice mode="send" walletSnapshot={walletSnapshot} />
              <SendPanel
                key={copilotAction?.tool === "prepare_send" ? copilotAction.id : "send"}
                walletSnapshot={walletSnapshot}
                onActivitySaved={saveLocalActivity}
                onActivityUpdated={updateLocalActivityByHash}
                copilotAction={copilotAction}
              />
            </>
          )}
        </div>
      </div>

      <ReceiveModal
        open={receiveOpen}
        onClose={() => {
          setReceiveOpen(false);
          if (router.pathname === "/receive") void router.replace("/");
        }}
        address={walletSnapshot.address}
        networkLabel={walletSnapshot?.activeChainName || arcTestnet.name}
      />
    </AppShell>
  );
}

export default function WalletRoute({ initialView = "dashboard", initialReceiveOpen = false }) {
  const walletSnapshot = useArcWalletSnapshot();
  const view = normalizeWalletView(initialView);
  const [title, description] = PAGE_META[view] || PAGE_META.dashboard;
  const canonicalPath = view === "dashboard" ? "" : VIEW_ROUTES[view];

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta name="theme-color" content="#061326" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={`${SITE_URL}${canonicalPath}`} />
        <meta name="twitter:card" content="summary" />
        <link rel="canonical" href={`${SITE_URL}${canonicalPath}`} />
      </Head>
      {walletSnapshot.isSignedIn ? (
        <ConnectedWalletExperience
          initialView={view}
          initialReceiveOpen={initialReceiveOpen}
          walletSnapshot={walletSnapshot}
        />
      ) : (
        <WalletLoginScreen />
      )}
    </>
  );
}
