import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import SiteFooter from "./site-footer";

export default function LegalPage({ title, description, children }) {
  return (
    <main className="legal-page">
      <Head>
        <title>{`${title} | Lumexa`}</title>
        <meta name="description" content={description} />
        <meta name="robots" content="index,follow" />
      </Head>
      <header className="legal-topbar">
        <Link href="/" className="login-brand">
          <span>
            <Image src="/lumexa-wallet-mark.png" alt="" width={38} height={38} sizes="38px" />
          </span>
          <div>
            <strong>Lumexa</strong>
            <small>AI Wallet</small>
          </div>
        </Link>
        <Link href="/" className="button button-secondary">
          Back to wallet
        </Link>
      </header>
      <article className="legal-card">
        <span className="eyebrow">Lumexa AI Wallet</span>
        <h1>{title}</h1>
        <p className="legal-updated">Updated September 10, 2026</p>
        {children}
      </article>
      <SiteFooter />
    </main>
  );
}
