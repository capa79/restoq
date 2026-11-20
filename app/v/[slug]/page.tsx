import type { Metadata, Viewport } from "next";
import { notFound, redirect } from "next/navigation";
import { loginAction } from "../../auth-actions";
import { getVenue } from "@/lib/venue";
import { inkFor } from "@/lib/brand";
import { googleEnabled } from "@/lib/google-auth";
import { getCurrentUser } from "@/lib/session";
import { getUiLang } from "@/lib/i18n";
import { LangSwitch } from "../../lang-switch";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const v = await getVenue((await params).slug);
  if (!v) return { title: "Ikke funnet – Restoq" };
  const icon = `/v/${v.slug}/ikon`;
  return {
    title: `${v.name} – lager og bestilling`,
    robots: { index: false, follow: false },
    manifest: `/v/${v.slug}/manifest.webmanifest`,
    icons: { icon: `${icon}?s=192`, apple: `${icon}?s=180` },
    appleWebApp: { capable: true, title: v.name, statusBarStyle: "black-translucent" },
  };
}
export async function generateViewport({ params }: P): Promise<Viewport> {
  const v = await getVenue((await params).slug);
  return { themeColor: v?.brand.head ?? "#141A18" };
}

const ERR: Record<string, string> = {
  feil: "Feil e-post eller passord.",
  mangler: "Fyll inn e-post og passord.",
  sperret: "For mange forsøk. Vent 15 minutter og prøv igjen.",
  utlopt: "Det midlertidige passordet har gått ut. Be lederen din om et nytt.",
};

export default async function Venue({ params, searchParams }: P) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const v = await getVenue(slug);
  if (!v) notFound();
  const me = await getCurrentUser().catch(() => null);
  const member = me && (me.org_id === v.id || me.role === "admin");
  if (member && me.org_id === v.id && sp.app && !me.must_change_password) redirect("/app");
  const lang = await getUiLang();
  const b = v.brand;
  const style = { "--vh": b.head, "--vh-ink": inkFor(b.head), "--va": b.accent, "--va-ink": inkFor(b.accent) } as React.CSSProperties;
  const err = sp.feil ? ERR[sp.feil] : null;
  return (
    <div className="venue" style={style}>
      <section className="venue-hero">
        {v.hasHero ? <img className="venue-bg" src={`/v/${v.slug}/bilde?v=${b.hero ?? ""}`} alt="" /> : null}
        <div className="venue-shade" />
        <div className="venue-top">
          <span className="venue-badge">{b.logo ? <img className="venue-logo" src={b.logo} alt={v.name} /> : <span className="venue-word" translate="no">{v.name}</span>}</span>
          <LangSwitch current={lang} />
        </div>
        <div className="venue-intro">
          <p className="venue-kicker">Lager · Bestilling · Varetelling</p>
          <h1 translate="no">{v.name}</h1>
          {b.tagline ? <p className="venue-tag" translate="no">{b.tagline}</p> : null}
        </div>
      </section>

      <section className="venue-panel">
        <div className="venue-card">
          {member ? (
            <>
              <h2>Hei{me.name ? `, ${me.name.split(" ")[0]}` : ""}!</h2>
              <p className="venue-muted">Du er logget inn{me.org_id === v.id ? "" : " som administrator"}.</p>
              <a className="venue-btn" href={me.must_change_password ? "/bytt-passord" : me.org_id === v.id ? "/app" : "/admin"}>{me.org_id === v.id ? "Åpne appen" : "Til admin"}</a>
            </>
          ) : (
            <>
              <h2>Logg inn</h2>
              <p className="venue-muted">For ansatte og ledere hos <span translate="no">{v.name}</span>.</p>
              {sp.ut ? <div className="venue-note ok">Du er logget ut.</div> : null}
              {err ? <div className="venue-note bad">{err}</div> : null}
              {googleEnabled() ? (
                <a className="venue-btn ghost" href={`/api/auth/google/start?next=${encodeURIComponent("/app")}`}>Logg inn med Google</a>
              ) : null}
              <form action={loginAction} className="venue-form">
                <input type="hidden" name="next" value="/app" />
                <input type="hidden" name="from" value={`/v/${v.slug}`} />
                <label>E-post<input name="email" type="email" required autoComplete="username" defaultValue={sp.e ?? ""} /></label>
                <label>Passord<input name="password" type="password" required autoComplete="current-password" /></label>
                <button className="venue-btn" type="submit">Logg inn</button>
              </form>
              <p className="venue-muted small">Har du ikke konto? Lederen din legger deg til.</p>
            </>
          )}
          <details className="venue-install">
            <summary>Legg appen på hjemskjermen</summary>
            <p><b>iPhone:</b> Åpne siden i Safari, trykk Del-knappen og «Legg til på Hjem-skjerm».</p>
            <p><b>Android:</b> Åpne menyen (⋮) i Chrome og velg «Installer app» eller «Legg til på startskjermen».</p>
          </details>
        </div>
        <footer className="venue-foot">
          {v.website ? <a href={v.website} target="_blank" rel="noopener noreferrer" translate="no">{new URL(v.website).hostname.replace(/^www\./, "")}</a> : <span />}
          <a href="https://restoq.no" className="venue-powered" translate="no">powered by <b>Restoq</b></a>
        </footer>
      </section>
    </div>
  );
}
