import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import AppNav from "./app-nav";
import SiteFooter from "./site-footer";
import { useTheme } from "./theme-provider";
const WalletShellContext = createContext({ closeMobileNav: () => {} });
export function useWalletShell() {
  return useContext(WalletShellContext);
}

export default function AppShell({ children, walletSnapshot, onOpenAssistant }) {
  const { theme, toggleTheme } = useTheme();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);
  const shellContext = useMemo(() => ({ closeMobileNav }), [closeMobileNav]);

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
          onToggleTheme={toggleTheme}
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
