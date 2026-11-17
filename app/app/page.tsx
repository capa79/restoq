import Script from "next/script";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Restoq", robots: { index: false } };
export const dynamic = "force-dynamic";

// Selve appen er et klientskript (public/restoq-app.js) som henter og lagrer data via /api/data.
export default async function AppPage() {
  const me = await requireUser();
  if (!me.org_id) redirect(me.role === "admin" ? "/admin" : "/login");
  const boot = JSON.stringify({ name: me.name, email: me.email, role: me.role, org: me.org_name }).replace(/</g, "\\u003c");
  return (
    <>
      <link rel="stylesheet" href="/restoq-app.css" precedence="default" />
      <div className="app">
        <header className="top">
          <img id="hLogo" className="hide" alt="" />
          <div>
            <div className="title" id="hTitle">Restoq</div>
            <div className="powered hide" id="hSub">powered by <b>Restoq</b></div>
          </div>
          <div className="sp" />
          <span className="sync" id="sync"><i /><span>Kobler til …</span></span>
          {me.role === "admin" ? <a className="iconbtn" href="/admin">Admin</a> : null}
          <button className="iconbtn" id="btnSettings" aria-label="Innstillinger">⚙<span className="lbl"> Innstillinger</span></button>
          <form method="post" action="/api/auth/logout" style={{ margin: 0 }}><button className="iconbtn" type="submit" title={`Logget inn som ${me.email}`}>Logg ut</button></form>
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
