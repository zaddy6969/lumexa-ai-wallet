import { useEffect, useState, useSyncExternalStore } from "react";
import AppNav from "./app-nav";
import SiteFooter from "./site-footer";

const WALLET_THEME_KEY = "lumexa-wallet-theme";

function getPreferredTheme() {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(WALLET_THEME_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
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
    () => "light"
  );
  const [selectedTheme, setSelectedTheme] = useState(null);
  const theme = selectedTheme || preferredTheme;

  useEffect(() => {
    document.documentElement.dataset.walletTheme = theme;
    document.body.dataset.walletTheme = theme;
    window.localStorage.setItem(WALLET_THEME_KEY, theme);
  }, [theme]);

  return (
    <div className="wallet-shell" data-wallet-theme={theme}>
      <a className="skip-link" href="#wallet-content">
        Skip to wallet content
      </a>
      <AppNav
        walletSnapshot={walletSnapshot}
        theme={theme}
        onToggleTheme={() => setSelectedTheme(theme === "dark" ? "light" : "dark")}
        onOpenAssistant={onOpenAssistant}
      />
      <main className="wallet-frame">{children}</main>
      <SiteFooter compact />
    </div>
  );
}
