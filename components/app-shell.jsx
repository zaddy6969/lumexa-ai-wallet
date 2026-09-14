import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore
} from "react";
import AppNav from "./app-nav";
import SiteFooter from "./site-footer";

const WALLET_THEME_KEY = "lumexa-wallet-theme";
const WalletShellContext = createContext({ closeMobileNav: () => {} });

export function useWalletShell() {
  return useContext(WalletShellContext);
}

function getPreferredTheme() {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(WALLET_THEME_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return "dark";
}

function subscribeToThemePreference(onStoreChange) {
  if (typeof window === "undefined") return () => {};
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  const handlePreferenceChange = () => onStoreChange();
  window.addEventListener("storage", handlePreferenceChange);
  media?.addEventListener?.("change", handlePreferenceChange);
  return () => {
    window.removeEventListener("storage", handlePreferenceChange);
    media?.removeEventListener?.("change", handlePreferenceChange);
  };
}

export default function AppShell({ children, walletSnapshot, onOpenAssistant }) {
  const preferredTheme = useSyncExternalStore(
    subscribeToThemePreference,
    getPreferredTheme,
    () => "dark"
  );
  const [selectedTheme, setSelectedTheme] = useState(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const theme = selectedTheme || preferredTheme;
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);
  const shellContext = useMemo(() => ({ closeMobileNav }), [closeMobileNav]);

  useEffect(() => {
    document.documentElement.dataset.walletTheme = theme;
    document.body.dataset.walletTheme = theme;
    window.localStorage.setItem(WALLET_THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (!mobileNavOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") closeMobileNav();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [closeMobileNav, mobileNavOpen]);

  return (
    <WalletShellContext.Provider value={shellContext}>
      <div
        className="wallet-shell"
        data-wallet-theme={theme}
        data-mobile-nav-open={mobileNavOpen ? "true" : "false"}
      >
        <a className="skip-link" href="#wallet-content">
          Skip to wallet content
        </a>
        <AppNav
          walletSnapshot={walletSnapshot}
          theme={theme}
          mobileNavOpen={mobileNavOpen}
          onToggleMobileNav={() => setMobileNavOpen((current) => !current)}
          onToggleTheme={() => setSelectedTheme(theme === "dark" ? "light" : "dark")}
          onOpenAssistant={onOpenAssistant}
        />
        <button
          type="button"
          className="mobile-nav-backdrop"
          aria-label="Close wallet navigation"
          aria-hidden={!mobileNavOpen}
          tabIndex={mobileNavOpen ? 0 : -1}
          onClick={closeMobileNav}
        />
        <main className="wallet-frame">{children}</main>
        <SiteFooter compact />
      </div>
    </WalletShellContext.Provider>
  );
}
