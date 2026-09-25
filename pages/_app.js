import { ThemeProvider } from "../components/theme-provider";
import "@rainbow-me/rainbowkit/styles.css";
import AppErrorBoundary from "../components/app-error-boundary";
import AppProviders from "../components/app-providers";
import "../styles/lumexa.css";
import "../styles/royal.css";

export default function App({ Component, pageProps }) {
  return (
    <AppErrorBoundary>
      <ThemeProvider>
        <AppProviders>
          <Component {...pageProps} />
        </AppProviders>
      </ThemeProvider>
    </AppErrorBoundary>
  );
}
