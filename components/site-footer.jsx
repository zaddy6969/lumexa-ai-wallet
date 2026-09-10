import Link from "next/link";

export default function SiteFooter({ compact = false }) {
  return (
    <footer className={`site-footer ${compact ? "is-compact" : ""}`}>
      <span>© 2026 Lumexa</span>
      <nav aria-label="Legal and support">
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <a
          href="https://github.com/zaddy6969/lumexa-ai-wallet/issues"
          target="_blank"
          rel="noreferrer"
        >
          Support
        </a>
      </nav>
      <span>Non-custodial · Testnet</span>
    </footer>
  );
}
