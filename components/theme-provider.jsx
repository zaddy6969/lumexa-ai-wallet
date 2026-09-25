import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore
} from "react";
const ThemeContext = createContext({ theme: "dark", toggleTheme: () => {} });
function readTheme() {
  try {
    return localStorage.getItem("lumexa-wallet-theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}
function subscribe(callback) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}
export function ThemeProvider({ children }) {
  const stored = useSyncExternalStore(subscribe, readTheme, () => "dark");
  const [selected, setSelected] = useState(null);
  const theme = selected || stored;
  useEffect(() => {
    document.documentElement.dataset.walletTheme = theme;
    document.body.dataset.walletTheme = theme;
    try {
      localStorage.setItem("lumexa-wallet-theme", theme);
    } catch {}
  }, [theme]);
  const value = useMemo(
    () => ({ theme, toggleTheme: () => setSelected(theme === "dark" ? "light" : "dark") }),
    [theme]
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
export const useTheme = () => useContext(ThemeContext);
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      onClick={toggleTheme}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        aria-hidden="true"
      >
        {theme === "dark" ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
          </>
        ) : (
          <path d="M20 14A8.5 8.5 0 0 1 10 4a8.5 8.5 0 1 0 10 10Z" />
        )}
      </svg>
    </button>
  );
}
