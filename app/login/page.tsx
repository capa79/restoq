import Link from "next/link";
import { redirect } from "next/navigation";
import { loginAction } from "../auth-actions";
import { SiteNav } from "../site-chrome";
import { googleEnabled } from "@/lib/google-auth";
import { getCurrentUser, homeFor, safeNext } from "@/lib/session";

export const metadata = { title: "Logg inn – Restoq", robots: { index: false } };

const ERR: Record<string, string> = {
  feil: "Feil e-post eller passord.",
  mangler: "Fyll inn e-post og passord.",
  sperret: "For mange forsøk. Vent 15 minutter og prøv igjen.",
  utlopt: "Det midlertidige passordet har gått ut. Be lederen din om et nytt.",
  "ingen-kunde": "Kontoen din er ikke knyttet til noen kunde. Kontakt Restoq.",
};
const GERR: Record<string, string> = {
  "ingen-konto": "Google-kontoen har ikke tilgang til Restoq. Be lederen din legge deg til med samme e-postadresse.",
  feil: "Innloggingen med Google mislyktes. Prøv igjen.",
  avbrutt: "Innloggingen med Google ble avbrutt.",
  av: "Innlogging med Google er ikke slått på.",
};

export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const me = await getCurrentUser().catch(() => null);
  if (me && !sp.feil) redirect(me.must_change_password ? "/bytt-passord" : homeFor(me, next));
  const err = (sp.feil && ERR[sp.feil]) || (sp.google && GERR[sp.google]);
  return (
    <div className="site auth">
      <SiteNav links={false} />
      <main className="authbox">
        <h1>Logg inn</h1>
        <p className="muted" style={{ marginBottom: 20 }}>For ansatte og ledere hos kunder av Restoq.</p>
        <div style={{ display: "grid", gap: 14 }}>
          {sp.ut ? <div className="note ok">Du er logget ut.</div> : null}
          {err ? <div className="note bad">{err}</div> : null}
          {googleEnabled() ? (
            <>
              <a className="gbtn" href={`/api/auth/google/start?next=${encodeURIComponent(next)}`}>
                <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
                Logg inn med Google
              </a>
              <div className="or">eller</div>
            </>
          ) : null}
          <form action={loginAction} className="box">
            <input type="hidden" name="next" value={next} />
            <label className="f">E-post<input name="email" type="email" required autoComplete="username" defaultValue={sp.e ?? ""} /></label>
            <label className="f">Passord<input name="password" type="password" required autoComplete="current-password" /></label>
            <button className="btn dark" type="submit">Logg inn</button>
          </form>
          <p className="small muted">Har du ikke konto? Lederen din legger deg til. Nye kunder kan <Link href="/#kontakt">booke en demo</Link>.</p>
        </div>
      </main>
    </div>
  );
}
