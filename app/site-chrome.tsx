import Link from "next/link";
import { getUiLang } from "@/lib/i18n";
import { LangSwitch } from "./lang-switch";
import { LogoFull } from "./logo";

export { LogoMark as Logo } from "./logo";

export async function SiteNav({ links = true }: { links?: boolean }) {
  const lang = await getUiLang();
  return (
    <header className="nav">
      <div className="wrap">
        <Link href="/" className="logo" aria-label="Restoq – til forsiden"><LogoFull height={34} /></Link>
        {links ? (
          <nav aria-label="Hovedmeny">
            <a href="/#slik">Slik fungerer det</a>
            <a href="/#funksjoner">Funksjoner</a>
            <a href="/#faktura">Faktura og Tripletex</a>
            <a href="/#whitelabel">White label</a>
            <a href="/#kontakt">Kontakt</a>
          </nav>
        ) : <div style={{ flex: 1 }} />}
        <LangSwitch current={lang} />
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
