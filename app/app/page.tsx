import Script from "next/script";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { getUiLang } from "@/lib/i18n";
import { LangSwitch } from "../lang-switch";

export const metadata = { title: "Restoq", robots: { index: false } };
export const dynamic = "force-dynamic";

// Selve appen er et klientskript (public/restoq-app.js) som henter og lagrer data via /api/data.
export default async function AppPage() {
  const me = await requireUser();
  const lang = await getUiLang();
  if (!me.org_id) {
    if (me.role === "admin") redirect("/admin");
    if (me.is_developer) redirect("/utvikler");
    redirect("/login?feil=ingen-kunde");
  }
  const boot = JSON.stringify({ name: me.name, email: me.email, role: me.role, org: me.org_name, dev: me.is_developer, version: (process.env.RENDER_GIT_COMMIT ?? "").slice(0, 7) }).replace(/</g, "\\u003c");
  return (
    <>
      <link rel="stylesheet" href="/restoq-app.css" precedence="default" />
      <div className="app">
        <header className="top">
          <img id="hLogo" className="hide" alt="" />
          <div className="hname">
            <div className="title" id="hTitle" translate="no">{me.org_name ?? "Restoq"}</div>
            <div className="powered hide" id="hSub" translate="no">powered by <b>Restoq</b></div>
          </div>
          <div className="sp" />
          <LangSwitch current={lang} />
          <span className="sync" id="sync"><i /><span>Kobler til …</span></span>
          {me.role === "admin" ? <a className="iconbtn" href="/admin">Admin</a> : null}
          {me.is_developer ? <a className="iconbtn" href="/utvikler">Utvikler</a> : null}
          <button className="iconbtn" id="btnSettings" aria-label="Innstillinger">⚙<span className="lbl"> Innstillinger</span></button>
          <form method="post" action="/api/auth/logout" style={{ margin: 0 }}><button className="iconbtn" type="submit">Logg ut</button></form>
        </header>
        <main id="main"><div className="wrap" id="view" /></main>
        <nav className="tabs" id="tabs" />
      </div>
      <div id="layer" />
      <script id="boot" type="application/json" dangerouslySetInnerHTML={{ __html: boot }} />
      <Script src="/restoq-app.js" strategy="afterInteractive" />
    </>
  );
}
