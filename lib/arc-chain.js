const sepolia = {
  id: 11155111,
  name: "Ethereum Sepolia",
  nativeCurrency: {
    name: "Sepolia Ether",
    symbol: "ETH",
    decimals: 18
  },
  rpcUrls: {
    default: {
      http: [
        process.env.NEXT_PUBLIC_ETHEREUM_SEPOLIA_RPC_URL ||
          "https://ethereum-sepolia-rpc.publicnode.com"
      ]
    }
  },
  blockExplorers: {
    default: {
      name: "Etherscan",
      url: "https://sepolia.etherscan.io"
    }
  },
  testnet: true
};

const baseSepolia = {
  id: 84532,
  name: "Base Sepolia",
  nativeCurrency: {
    name: "Sepolia Ether",
    symbol: "ETH",
    decimals: 18
  },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org"]
    }
  },
  blockExplorers: {
    default: {
      name: "BaseScan",
      url: "https://sepolia.basescan.org"
    }
  },
  testnet: true
};

const ethereumMainnet = {
  id: 1,
  name: "Ethereum",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18
  },
  rpcUrls: {
    default: {
      http: [
        process.env.NEXT_PUBLIC_ETHEREUM_MAINNET_RPC_URL || "https://ethereum-rpc.publicnode.com"
      ]
    }
  },
  blockExplorers: {
    default: {
      name: "Etherscan",
      url: "https://etherscan.io"
    }
  },
  testnet: false
};

const baseMainnet = {
  id: 8453,
  name: "Base",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18
  },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_BASE_MAINNET_RPC_URL || "https://mainnet.base.org"]
    }
  },
  blockExplorers: {
    default: {
      name: "BaseScan",
      url: "https://basescan.org"
    }
  },
  testnet: false
};

export const ARC_MAINNET_CHAIN_ID = 5042;
export const ARC_TESTNET_CHAIN_ID = 5042002;
export const ARC_PUBLIC_MAINNET_LAUNCH_DATE = "2026-09-16";
export const ARC_NETWORK_MODE =
  String(process.env.NEXT_PUBLIC_ARC_NETWORK || "testnet").toLowerCase() === "mainnet"
    ? "mainnet"
    : "testnet";
export const ARC_MAINNET_REQUESTED = ARC_NETWORK_MODE === "mainnet";

export const ARC_PUBLIC_TESTNET_NETWORK_CONFIG = {
  chainId: ARC_TESTNET_CHAIN_ID,
  rpcUrl:
    process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL ||
    process.env.NEXT_PUBLIC_ARC_RPC_URL ||
    "https://rpc.testnet.arc.network",
  webSocketUrl: process.env.NEXT_PUBLIC_ARC_TESTNET_WS_URL || "wss://rpc.testnet.arc.network",
  currencySymbol: "USDC",
  explorerUrl: "https://testnet.arcscan.app"
};

export const ARC_MAINNET_NETWORK_CONFIG = {
  chainId: ARC_MAINNET_CHAIN_ID,
  rpcUrl: process.env.NEXT_PUBLIC_ARC_MAINNET_RPC_URL || "",
  webSocketUrl: process.env.NEXT_PUBLIC_ARC_MAINNET_WS_URL || "",
  currencySymbol: "USDC",
  explorerUrl: process.env.NEXT_PUBLIC_ARC_MAINNET_EXPLORER_URL || ""
};

export const ARC_MAINNET_CONFIGURATION_COMPLETE = Boolean(
  ARC_MAINNET_NETWORK_CONFIG.rpcUrl && ARC_MAINNET_NETWORK_CONFIG.explorerUrl
);

export const ARC_MAINNET_ENABLED =
  String(process.env.NEXT_PUBLIC_ARC_MAINNET_ENABLED || "false").toLowerCase() === "true";

export const ARC_MAINNET_READY =
  !ARC_MAINNET_REQUESTED || (ARC_MAINNET_CONFIGURATION_COMPLETE && ARC_MAINNET_ENABLED);

export const ARC_ACTIVE_NETWORK_CONFIG = ARC_MAINNET_REQUESTED
  ? ARC_MAINNET_NETWORK_CONFIG
  : ARC_PUBLIC_TESTNET_NETWORK_CONFIG;

// Compatibility alias for older components. It intentionally follows the active Arc network.
export const ARC_TESTNET_NETWORK_CONFIG = ARC_ACTIVE_NETWORK_CONFIG;

export const ARC_MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";

export const arcTestnetChain = {
  id: ARC_PUBLIC_TESTNET_NETWORK_CONFIG.chainId,
  name: "Arc Testnet",
  iconBackground: "#06131d",
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 18
  },
  rpcUrls: {
    default: {
      http: [ARC_PUBLIC_TESTNET_NETWORK_CONFIG.rpcUrl],
      webSocket: [ARC_PUBLIC_TESTNET_NETWORK_CONFIG.webSocketUrl]
    },
    public: {
      http: [ARC_PUBLIC_TESTNET_NETWORK_CONFIG.rpcUrl],
      webSocket: [ARC_PUBLIC_TESTNET_NETWORK_CONFIG.webSocketUrl]
    }
  },
  blockExplorers: {
    default: {
      name: "ArcScan",
      url: ARC_PUBLIC_TESTNET_NETWORK_CONFIG.explorerUrl
    }
  },
  contracts: {
    multicall3: {
      address: ARC_MULTICALL3_ADDRESS,
      blockCreated: 1n
    }
  },
  testnet: true
};

export const arcMainnet = {
  id: ARC_MAINNET_CHAIN_ID,
  name: "Arc Mainnet",
  iconBackground: "#06131d",
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 18
  },
  rpcUrls: {
    default: {
      http: ARC_MAINNET_NETWORK_CONFIG.rpcUrl ? [ARC_MAINNET_NETWORK_CONFIG.rpcUrl] : [],
      ...(ARC_MAINNET_NETWORK_CONFIG.webSocketUrl
        ? { webSocket: [ARC_MAINNET_NETWORK_CONFIG.webSocketUrl] }
        : {})
    },
    public: {
      http: ARC_MAINNET_NETWORK_CONFIG.rpcUrl ? [ARC_MAINNET_NETWORK_CONFIG.rpcUrl] : [],
      ...(ARC_MAINNET_NETWORK_CONFIG.webSocketUrl
        ? { webSocket: [ARC_MAINNET_NETWORK_CONFIG.webSocketUrl] }
        : {})
    }
  },
  blockExplorers: {
    default: {
      name: "Arc Explorer",
      url: ARC_MAINNET_NETWORK_CONFIG.explorerUrl
    }
  },
  testnet: false
};

export const arcActiveChain = ARC_MAINNET_REQUESTED ? arcMainnet : arcTestnetChain;

// Compatibility alias used throughout the existing wallet. This now points to the selected Arc network.
export const arcTestnet = arcActiveChain;

export const ARC_NETWORK_DETAILS = [
  { label: "RPC", value: ARC_ACTIVE_NETWORK_CONFIG.rpcUrl },
  { label: "Explorer", value: ARC_ACTIVE_NETWORK_CONFIG.explorerUrl },
  ...(!ARC_MAINNET_REQUESTED ? [{ label: "Faucet", value: "https://faucet.circle.com" }] : [])
].filter((item) => item.value);

export const ARC_NETWORK_INFO_ITEMS = [
  {
    label: "Chain ID",
    value: String(ARC_ACTIVE_NETWORK_CONFIG.chainId)
  },
  {
    label: "Gas Token",
    value: ARC_ACTIVE_NETWORK_CONFIG.currencySymbol
  },
  ...(ARC_ACTIVE_NETWORK_CONFIG.rpcUrl
    ? [
        {
          label: "RPC",
          value: ARC_ACTIVE_NETWORK_CONFIG.rpcUrl,
          href: ARC_ACTIVE_NETWORK_CONFIG.rpcUrl
        }
      ]
    : []),
  ...(ARC_ACTIVE_NETWORK_CONFIG.explorerUrl
    ? [
        {
          label: "Explorer",
          value: ARC_ACTIVE_NETWORK_CONFIG.explorerUrl,
          href: ARC_ACTIVE_NETWORK_CONFIG.explorerUrl
        }
      ]
    : []),
  ...(!ARC_MAINNET_REQUESTED
    ? [
        {
          label: "Faucet",
          value: "https://faucet.circle.com",
          href: "https://faucet.circle.com"
        }
      ]
    : [])
];

// Compatibility alias for existing UI code.
export const ARC_TESTNET_INFO_ITEMS = ARC_NETWORK_INFO_ITEMS;

const ARC_TESTNET_USDC_ERC20_ADDRESS =
  process.env.NEXT_PUBLIC_ARC_TESTNET_USDC_ADDRESS || "0x3600000000000000000000000000000000000000";
const ARC_TESTNET_EURC_ERC20_ADDRESS =
  process.env.NEXT_PUBLIC_ARC_TESTNET_EURC_ADDRESS || "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";
const ARC_TESTNET_CIRBTC_ERC20_ADDRESS =
  process.env.NEXT_PUBLIC_ARC_TESTNET_CIRBTC_ADDRESS ||
  "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF";

// Arc mainnet genesis allocates the USDC predeploy at this address. Other assets stay opt-in
// until Circle publishes their production addresses.
export const ARC_MAINNET_USDC_ERC20_ADDRESS =
  process.env.NEXT_PUBLIC_ARC_MAINNET_USDC_ADDRESS || "0x3600000000000000000000000000000000000000";
export const ARC_MAINNET_EURC_ERC20_ADDRESS =
  process.env.NEXT_PUBLIC_ARC_MAINNET_EURC_ADDRESS || "";
export const ARC_MAINNET_CIRBTC_ERC20_ADDRESS =
  process.env.NEXT_PUBLIC_ARC_MAINNET_CIRBTC_ADDRESS || "";

export const ARC_USDC_ERC20_ADDRESS = ARC_MAINNET_REQUESTED
  ? ARC_MAINNET_USDC_ERC20_ADDRESS
  : ARC_TESTNET_USDC_ERC20_ADDRESS;
export const ARC_EURC_ERC20_ADDRESS = ARC_MAINNET_REQUESTED
  ? ARC_MAINNET_EURC_ERC20_ADDRESS
  : ARC_TESTNET_EURC_ERC20_ADDRESS;
export const ARC_CIRBTC_ERC20_ADDRESS = ARC_MAINNET_REQUESTED
  ? ARC_MAINNET_CIRBTC_ERC20_ADDRESS
  : ARC_TESTNET_CIRBTC_ERC20_ADDRESS;

const testnetPortfolioTokens = [
  {
    symbol: "USDC",
    name: "USD Coin",
    address: ARC_TESTNET_USDC_ERC20_ADDRESS,
    decimals: 6,
    priceUsd: null,
    accent: "U",
    description: "Arc gas and payment asset"
  },
  {
    symbol: "EURC",
    name: "Euro Coin",
    address: ARC_TESTNET_EURC_ERC20_ADDRESS,
    decimals: 6,
    priceUsd: null,
    accent: "E",
    description: "Euro-denominated stablecoin on Arc"
  },
  {
    symbol: "cirBTC",
    name: "Circle Bitcoin",
    address: ARC_TESTNET_CIRBTC_ERC20_ADDRESS,
    decimals: 8,
    priceUsd: null,
    accent: "B",
    description: "Circle Wrapped Bitcoin testnet asset on Arc"
  }
];

const mainnetPortfolioTokens = [
  {
    symbol: "USDC",
    name: "USD Coin",
    address: ARC_MAINNET_USDC_ERC20_ADDRESS,
    decimals: 6,
    priceUsd: 1,
    accent: "U",
    description: "Arc native gas and payment asset"
  },
  ...(ARC_MAINNET_EURC_ERC20_ADDRESS
    ? [
        {
          symbol: "EURC",
          name: "Euro Coin",
          address: ARC_MAINNET_EURC_ERC20_ADDRESS,
          decimals: 6,
          priceUsd: 1.08,
          accent: "E",
          description: "Euro-denominated stablecoin on Arc"
        }
      ]
    : []),
  ...(ARC_MAINNET_CIRBTC_ERC20_ADDRESS
    ? [
        {
          symbol: "cirBTC",
          name: "Circle Bitcoin",
          address: ARC_MAINNET_CIRBTC_ERC20_ADDRESS,
          decimals: 8,
          priceUsd: 0,
          accent: "B",
          description: "Bitcoin-denominated asset on Arc"
        }
      ]
    : [])
];

export const ARC_PORTFOLIO_TOKENS = ARC_MAINNET_REQUESTED
  ? mainnetPortfolioTokens
  : testnetPortfolioTokens;

const testnetAppKitOptions = [
  {
    id: arcTestnetChain.id,
    name: arcTestnetChain.name,
    shortName: "Arc",
    appKitChain: "Arc_Testnet",
    appKitModuleKey: "ArcTestnet",
    gasToken: "USDC",
    explorerUrl: arcTestnetChain.blockExplorers.default.url,
    helper: "Use Arc Testnet for USDC send, receive, and activity."
  },
  {
    id: sepolia.id,
    name: sepolia.name,
    shortName: "ETH Sepolia",
    appKitChain: "Ethereum_Sepolia",
    appKitModuleKey: "EthereumSepolia",
    gasToken: "ETH",
    explorerUrl: sepolia.blockExplorers.default.url,
    helper: "Bridge testnet USDC from Ethereum Sepolia into Arc Testnet."
  },
  {
    id: baseSepolia.id,
    name: baseSepolia.name,
    shortName: "Base Sepolia",
    appKitChain: "Base_Sepolia",
    appKitModuleKey: "BaseSepolia",
    gasToken: "ETH",
    explorerUrl: baseSepolia.blockExplorers.default.url,
    helper: "Bridge testnet USDC from Base Sepolia into Arc Testnet."
  }
];

const mainnetAppKitOptions = [
  {
    id: arcMainnet.id,
    name: arcMainnet.name,
    shortName: "Arc",
    appKitChain: process.env.NEXT_PUBLIC_ARC_MAINNET_APP_KIT_CHAIN || "",
    appKitModuleKey: process.env.NEXT_PUBLIC_ARC_MAINNET_APP_KIT_MODULE_KEY || "",
    gasToken: "USDC",
    explorerUrl: ARC_MAINNET_NETWORK_CONFIG.explorerUrl,
    helper: "Arc Mainnet"
  },
  {
    id: ethereumMainnet.id,
    name: ethereumMainnet.name,
    shortName: "Ethereum",
    appKitChain: process.env.NEXT_PUBLIC_ETHEREUM_MAINNET_APP_KIT_CHAIN || "",
    appKitModuleKey: process.env.NEXT_PUBLIC_ETHEREUM_MAINNET_APP_KIT_MODULE_KEY || "",
    gasToken: "ETH",
    explorerUrl: ethereumMainnet.blockExplorers.default.url,
    helper: "Ethereum Mainnet"
  },
  {
    id: baseMainnet.id,
    name: baseMainnet.name,
    shortName: "Base",
    appKitChain: process.env.NEXT_PUBLIC_BASE_MAINNET_APP_KIT_CHAIN || "",
    appKitModuleKey: process.env.NEXT_PUBLIC_BASE_MAINNET_APP_KIT_MODULE_KEY || "",
    gasToken: "ETH",
    explorerUrl: baseMainnet.blockExplorers.default.url,
    helper: "Base Mainnet"
  }
];

export const APP_KIT_EVM_CHAIN_OPTIONS = ARC_MAINNET_REQUESTED
  ? mainnetAppKitOptions
  : testnetAppKitOptions;

export const ARC_APP_KIT_READY =
  !ARC_MAINNET_REQUESTED ||
  mainnetAppKitOptions.every((option) => Boolean(option.appKitChain && option.appKitModuleKey));

export const MULTICHAIN_WALLET_CHAINS = ARC_MAINNET_REQUESTED
  ? [arcMainnet, ethereumMainnet, baseMainnet]
  : [arcTestnetChain, sepolia, baseSepolia];

export const ARC_BRIDGE_SOURCE_OPTIONS = APP_KIT_EVM_CHAIN_OPTIONS.filter(
  (option) => option.id !== arcActiveChain.id
);

export const UNIFIED_BALANCE_SOURCE_OPTIONS = APP_KIT_EVM_CHAIN_OPTIONS;

const activeArcAppKitOption = APP_KIT_EVM_CHAIN_OPTIONS.find(
  (option) => option.id === arcActiveChain.id
);

export const ARC_BRIDGE_DESTINATION = {
  id: arcActiveChain.id,
  name: arcActiveChain.name,
  appKitChain: activeArcAppKitOption?.appKitChain || "",
  gasToken: arcActiveChain.nativeCurrency.symbol,
  explorerUrl: arcActiveChain.blockExplorers.default.url
};

export const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "YOUR_PROJECT_ID";

export const hasWalletConnectProjectId = walletConnectProjectId !== "YOUR_PROJECT_ID";
