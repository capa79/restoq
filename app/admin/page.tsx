import Link from "next/link";
import { createOrgAction, deleteOrgAction, leadHandledAction, loadPilotAction, openOrgAction } from "./actions";
import { logoutAction } from "../auth-actions";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { mailEnabled } from "@/lib/mail";
import { tripletexConfigured } from "@/lib/tripletex";
import { googleEnabled } from "@/lib/google-auth";

export const metadata = { title: "Admin – Restoq", robots: { index: false } };
export const dynamic = "force-dynamic";

const d = (v: Date | string | null) => (v ? new Date(v).toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric" }) : "–");

export default async function Admin({ searchParams }: { searchParams: Promise<{ ok?: string; feil?: string }> }) {
  const me = await requireAdmin();
  const sp = await searchParams;
  const p = await db();
  const orgs = (await p.query(
    `SELECT o.id, o.name, o.created_at, count(u.id) AS users, max(u.last_login_at) AS last_login,
            (SELECT count(*) FROM docs x WHERE x.org_id = o.id AND x.col = 'invoices') AS invoices
       FROM orgs o LEFT JOIN users u ON u.org_id = o.id GROUP BY o.id ORDER BY o.name`
  )).rows;
  const leads = (await p.query("SELECT * FROM leads ORDER BY handled, created_at DESC LIMIT 100")).rows;
  const log = (await p.query("SELECT a.*, o.name AS org FROM audit a LEFT JOIN orgs o ON o.id = a.org_id ORDER BY a.created_at DESC LIMIT 40")).rows;
  return (
    <div className="site">
      <header className="nav"><div className="wrap"><Link href="/" className="logo">Restoq admin</Link><div style={{ flex: 1 }} /><span className="small" style={{ opacity: 0.7 }}>{me.email}</span><form action={logoutAction}><button className="btn ghost sm">Logg ut</button></form></div></header>
      <main className="admin">
        {sp.ok ? <div className="note ok">{sp.ok}</div> : null}
        {sp.feil ? <div className="note bad">{sp.feil}</div> : null}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Oppsett</h3>
          <p className="small">E-post: {mailEnabled() ? "på" : "av (midlertidige passord vises her)"} · Google-innlogging: {googleEnabled() ? "på" : "av"} · Tripletex: {tripletexConfigured() ? (process.env.TRIPLETEX_ENV === "prod" ? "på (produksjon)" : "på (testmiljø)") : "av"}</p>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0, marginBottom: 12 }}>Ny kunde</h3>
          <form action={createOrgAction} className="row" style={{ alignItems: "end" }}>
            <label className="f" style={{ flex: 2, minWidth: 200 }}>Kunde (bar/restaurant)<input name="name" required /></label>
            <label className="f" style={{ flex: 2, minWidth: 200 }}>Leders e-post<input name="email" type="email" required /></label>
            <label className="f" style={{ flex: 1, minWidth: 150 }}>Leders navn<input name="owner" /></label>
            <button className="btn dark">Opprett kunde</button>
          </form>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0, marginBottom: 12 }}>Kunder ({orgs.length})</h3>
          <div style={{ overflowX: "auto" }}><table>
            <thead><tr><th>Kunde</th><th>Brukere</th><th>Fakturaer</th><th>Sist aktiv</th><th>Opprettet</th><th></th></tr></thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id}>
                  <td><b>{o.name}</b></td><td>{o.users}</td><td>{o.invoices}</td><td>{d(o.last_login)}</td><td>{d(o.created_at)}</td>
                  <td>
                    <div className="row" style={{ justifyContent: "flex-end" }}>
                      <form action={openOrgAction}><input type="hidden" name="org" value={o.id} /><button className="btn dark sm">Åpne app</button></form>
                      <form action={loadPilotAction}><input type="hidden" name="org" value={o.id} /><button className="btn line sm" title="Varer, leverandører og ukesalg fra About Contrasts">Last inn pilotdata</button></form>
                      <details><summary className="small" style={{ cursor: "pointer" }}>Slett</summary><form action={deleteOrgAction} className="row" style={{ marginTop: 6 }}><input type="hidden" name="org" value={o.id} /><input name="confirm" placeholder="Skriv kundens navn" style={{ minHeight: 36, width: 180 }} /><button className="btn red sm">Slett alt</button></form></details>
                    </div>
                  </td>
                </tr>
              ))}
              {!orgs.length ? <tr><td colSpan={6} className="muted">Ingen kunder ennå.</td></tr> : null}
            </tbody>
          </table></div>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0, marginBottom: 12 }}>Henvendelser fra forsiden</h3>
          <div style={{ overflowX: "auto" }}><table>
            <thead><tr><th>Dato</th><th>Navn</th><th>Firma</th><th>Kontakt</th><th>Steder</th><th>Melding</th><th></th></tr></thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} style={{ opacity: l.handled ? 0.5 : 1 }}>
                  <td>{d(l.created_at)}</td><td>{l.name}</td><td>{l.company}</td><td>{l.email}<br />{l.phone}</td><td>{l.venues}</td><td style={{ maxWidth: 320 }}>{l.message}</td>
                  <td><form action={leadHandledAction}><input type="hidden" name="id" value={l.id} /><button className="btn line sm">{l.handled ? "Åpne" : "Fulgt opp"}</button></form></td>
                </tr>
              ))}
              {!leads.length ? <tr><td colSpan={7} className="muted">Ingen henvendelser ennå.</td></tr> : null}
            </tbody>
          </table></div>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0, marginBottom: 12 }}>Siste hendelser</h3>
          <table><tbody>{log.map((a) => (<tr key={a.id}><td className="small">{new Date(a.created_at).toLocaleString("nb-NO")}</td><td className="small">{a.actor ?? "–"}</td><td className="small">{a.org ?? ""}</td><td className="small">{a.action} {a.detail}</td></tr>))}</tbody></table>
        </div>
      </main>
    </div>
  );
}
