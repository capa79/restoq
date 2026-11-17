import Link from "next/link";

export const Logo = () => (
  <svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#fff" /><path d="M18 46V18h15.5c6.2 0 10.5 3.7 10.5 9.3 0 4.2-2.4 7.3-6.2 8.6L45 46h-8.4l-6.4-9.4H25.4V46zm7.4-15.6h7.6c2.6 0 4.1-1.3 4.1-3.4s-1.5-3.4-4.1-3.4h-7.6z" fill="#141A18" /><rect x="18" y="50" width="28" height="3" rx="1.5" fill="#D2372B" /></svg>
);

export function SiteNav({ links = true }: { links?: boolean }) {
  return (
    <header className="nav">
      <div className="wrap">
        <Link href="/" className="logo"><Logo />Restoq</Link>
        {links ? (
          <nav aria-label="Hovedmeny">
            <a href="/#slik">Slik fungerer det</a>
            <a href="/#funksjoner">Funksjoner</a>
            <a href="/#faktura">Faktura og Tripletex</a>
            <a href="/#whitelabel">White label</a>
            <a href="/#kontakt">Kontakt</a>
          </nav>
        ) : <div style={{ flex: 1 }} />}
        <Link className="btn ghost sm" href="/login">Logg inn</Link>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const entity = process.env.LEGAL_ENTITY;
  const orgnr = process.env.LEGAL_ORGNR;
  return (
    <footer>
      <div className="wrap">
        <div><b style={{ color: "#fff" }}>Restoq</b> · Intelligent resource management{entity ? ` · Levert av ${entity}` : ""}{orgnr ? ` (org.nr. ${orgnr})` : ""}</div>
        <div className="row"><Link href="/personvern">Personvern</Link><Link href="/api-dokumentasjon">API</Link><Link href="/login">Logg inn</Link></div>
      </div>
    </footer>
  );
}
