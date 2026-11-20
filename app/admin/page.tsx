import Link from "next/link";
import {
  addUserAction, createOrgAction, deleteOrgAction, deleteUserAction, developerAction, editUserAction, leadAction, loadPilotAction,
  logoutUserAction, openOrgAction, resetPasswordAction, testMailAction, toggleAdminAction, toggleDeveloperAction, updateOrgAction,
} from "./actions";
import { logoutAction } from "../auth-actions";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { mailEnabled } from "@/lib/mail";
import { tripletexConfigured } from "@/lib/tripletex";
import { googleEnabled } from "@/lib/google-auth";
import { aiTranslateEnabled } from "@/lib/ai-translate";
import { kindLabel } from "@/lib/feedback";

export const metadata = { title: "Admin – Restoq", robots: { index: false } };
export const dynamic = "force-dynamic";

const d = (v: Date | string | null) => (v ? new Intl.DateTimeFormat("nb-NO", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Oslo" }).format(new Date(v)) : "–");
const dt = (v: Date | string | null) => (v ? new Intl.DateTimeFormat("nb-NO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Oslo" }).format(new Date(v)) : "–");
const nf = new Intl.NumberFormat("nb-NO");
type SP = { fane?: string; kunde?: string; q?: string; rolle?: string; ok?: string; feil?: string; vis?: string };
const TABS = [["oversikt", "Oversikt"], ["kunder", "Kunder"], ["brukere", "Brukere"], ["henvendelser", "Henvendelser"], ["logg", "Hendelseslogg"], ["oppsett", "Oppsett"]] as const;
const ROLE: Record<string, string> = { admin: "Administrator", owner: "Leder", staff: "Ansatt" };

export default async function Admin({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requireAdmin();
  const sp = await searchParams;
  const fane = TABS.some(([k]) => k === sp.fane) ? sp.fane! : "oversikt";
  const p = await db();
  const badge = (await p.query(
    `SELECT (SELECT count(*)::int FROM leads WHERE NOT handled) AS leads, (SELECT count(*)::int FROM feedback WHERE status = 'ny') AS fb,
            (SELECT count(*)::int FROM error_log WHERE at > now() - interval '24 hours') AS err`
  )).rows[0];
  return (
    <div className="site" data-no-translate>
      <header className="nav"><div className="wrap"><Link href="/" className="logo">Restoq admin</Link><div style={{ flex: 1 }} />
        <Link className="btn ghost sm" href="/utvikler">Utvikler{badge.fb ? ` (${badge.fb})` : ""}</Link>
        <span className="small" style={{ opacity: 0.7 }}>{me.email}</span><form action={logoutAction}><button className="btn ghost sm">Logg ut</button></form></div></header>
      <main className="admin">
        <nav className="devtabs" aria-label="Admin">
          {TABS.map(([k, l]) => (
            <Link key={k} href={k === "oversikt" ? "/admin" : `/admin?fane=${k}`} aria-current={fane === k ? "page" : undefined}>
              {l}{k === "henvendelser" && badge.leads ? <b>{badge.leads}</b> : null}
            </Link>
          ))}
        </nav>
        {sp.ok ? <div className="note ok">{sp.ok}</div> : null}
        {sp.feil ? <div className="note bad">{sp.feil}</div> : null}
        {fane === "kunder" ? (sp.kunde ? <Customer id={Number(sp.kunde)} meId={me.id} /> : <Customers />)
          : fane === "brukere" ? <Users sp={sp} meId={me.id} />
          : fane === "henvendelser" ? <Leads vis={sp.vis} />
          : fane === "logg" ? <Log q={sp.q} />
          : fane === "oppsett" ? <Setup email={me.email} />
          : <Overview badge={badge} />}
      </main>
    </div>
  );
}

async function Overview({ badge }: { badge: { leads: number; fb: number; err: number } }) {
  const p = await db();
  const [k, fb, leads, active] = await Promise.all([
    p.query(`SELECT (SELECT count(*)::int FROM orgs) AS orgs,
                    (SELECT count(*)::int FROM users WHERE role <> 'admin') AS users,
                    (SELECT count(*)::int FROM users WHERE role <> 'admin' AND last_login_at > now() - interval '7 days') AS active,
                    (SELECT count(*)::int FROM docs WHERE col = 'orders' AND data->>'orderDate' >= to_char(now() - interval '30 days', 'YYYY-MM-DD')) AS orders30,
                    (SELECT count(*)::int FROM docs WHERE col = 'counts' AND data->>'status' = 'fullført') AS counts,
                    (SELECT count(*)::int FROM docs WHERE col = 'invoices') AS invoices,
                    (SELECT count(*)::int FROM docs WHERE col = 'invoices' AND data->>'status' = 'avvik') AS avvik`),
    p.query("SELECT f.id, f.kind, f.message, f.created_at, o.name AS org FROM feedback f LEFT JOIN orgs o ON o.id = f.org_id WHERE f.status = 'ny' ORDER BY f.created_at DESC LIMIT 6"),
    p.query("SELECT id, name, company, created_at FROM leads WHERE NOT handled ORDER BY created_at DESC LIMIT 6"),
    p.query(`SELECT o.id, o.name, max(u.last_login_at) AS last, count(u.id)::int AS users
               FROM orgs o LEFT JOIN users u ON u.org_id = o.id GROUP BY o.id ORDER BY max(u.last_login_at) DESC NULLS LAST LIMIT 6`),
  ]);
  const s = k.rows[0];
  return (
    <>
      <div className="kpis">
        <Link className="card" href="/admin?fane=kunder"><span className="small muted">Kunder</span><b>{s.orgs}</b></Link>
        <Link className="card" href="/admin?fane=brukere"><span className="small muted">Brukere</span><b>{s.users}</b><span className="small muted">{s.active} aktive siste 7 dager</span></Link>
        <Link className="card" href="/admin?fane=henvendelser"><span className="small muted">Nye henvendelser</span><b>{badge.leads}</b></Link>
        <Link className="card" href="/utvikler"><span className="small muted">Nye tilbakemeldinger</span><b>{badge.fb}</b><span className="small muted">{badge.err} feil siste døgn</span></Link>
      </div>
      <div className="kpis">
        <div className="card"><span className="small muted">Bestillinger siste 30 dager</span><b>{s.orders30}</b></div>
        <div className="card"><span className="small muted">Fullførte varetellinger</span><b>{s.counts}</b></div>
        <div className="card"><span className="small muted">Fakturaer</span><b>{s.invoices}</b><span className="small muted">{s.avvik} med avvik</span></div>
        <Link className="card" href="/admin?fane=oppsett"><span className="small muted">Tjenester</span><b style={{ fontSize: 18 }}>{[mailEnabled() && "E-post", googleEnabled() && "Google", tripletexConfigured() && "Tripletex"].filter(Boolean).join(" · ") || "Ingen satt opp"}</b></Link>
      </div>
      <div className="grid2" style={{ alignItems: "start" }}>
        <div className="card"><div className="row" style={{ justifyContent: "space-between" }}><h3 style={{ margin: 0 }}>Nye tilbakemeldinger</h3><Link className="small" href="/utvikler">Alle</Link></div>
          {fb.rows.length ? <table><tbody>{fb.rows.map((f) => <tr key={f.id}><td className="small">{d(f.created_at)}</td><td><span className="tag">{kindLabel(f.kind)}</span></td><td><Link href={`/utvikler#fb-${f.id}`}>{String(f.message).slice(0, 90)}</Link><div className="small muted">{f.org ?? "–"}</div></td></tr>)}</tbody></table> : <p className="small muted">Ingen nye.</p>}
        </div>
        <div className="card"><div className="row" style={{ justifyContent: "space-between" }}><h3 style={{ margin: 0 }}>Nye henvendelser</h3><Link className="small" href="/admin?fane=henvendelser">Alle</Link></div>
          {leads.rows.length ? <table><tbody>{leads.rows.map((l) => <tr key={l.id}><td className="small">{d(l.created_at)}</td><td><Link href={`/admin?fane=henvendelser#lead-${l.id}`}>{l.company || l.name}</Link><div className="small muted">{l.name}</div></td></tr>)}</tbody></table> : <p className="small muted">Ingen ubehandlede.</p>}
        </div>
      </div>
      <div className="card"><h3 style={{ marginTop: 0 }}>Sist aktive kunder</h3>
        <table><tbody>{active.rows.map((o) => <tr key={o.id}><td><Link href={`/admin?fane=kunder&kunde=${o.id}`}><b>{o.name}</b></Link></td><td className="small">{o.users} brukere</td><td className="small">Sist aktiv {d(o.last)}</td></tr>)}</tbody></table>
      </div>
    </>
  );
}

async function Customers() {
  const p = await db();
  const orgs = (await p.query(
    `SELECT o.id, o.name, o.created_at, count(u.id)::int AS users, max(u.last_login_at) AS last,
            (SELECT count(*)::int FROM docs x WHERE x.org_id = o.id AND x.col = 'orders') AS orders,
            (SELECT count(*)::int FROM docs x WHERE x.org_id = o.id AND x.col = 'invoices') AS invoices,
            (SELECT count(*)::int FROM docs x, jsonb_object_keys(CASE WHEN jsonb_typeof(x.data->'ov') = 'object' THEN x.data->'ov' ELSE '{}'::jsonb END) k WHERE x.org_id = o.id AND x.col = 'config' AND x.id = 'items') AS items
       FROM orgs o LEFT JOIN users u ON u.org_id = o.id GROUP BY o.id ORDER BY o.name`
  )).rows;
  return (
    <>
      <div className="card">
        <h3 style={{ marginTop: 0, marginBottom: 12 }}>Ny kunde</h3>
        <form action={createOrgAction} className="row" style={{ alignItems: "end" }}>
          <input type="hidden" name="back" value="/admin?fane=kunder" />
          <label className="f" style={{ flex: 2, minWidth: 200 }}>Kunde (bar/restaurant)<input name="name" required /></label>
          <label className="f" style={{ flex: 2, minWidth: 200 }}>Leders e-post<input name="email" type="email" required /></label>
          <label className="f" style={{ flex: 1, minWidth: 150 }}>Leders navn<input name="owner" /></label>
          <button className="btn dark">Opprett kunde</button>
        </form>
        <p className="small muted" style={{ marginTop: 8 }}>Lederen får et midlertidig passord og legger selv til leverandører, varer og ansatte.</p>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0, marginBottom: 12 }}>Kunder ({orgs.length})</h3>
        <div style={{ overflowX: "auto" }}><table>
          <thead><tr><th>Kunde</th><th>Brukere</th><th>Varer</th><th>Bestillinger</th><th>Fakturaer</th><th>Sist aktiv</th><th /></tr></thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.id}>
                <td><Link href={`/admin?fane=kunder&kunde=${o.id}`}><b>{o.name}</b></Link><div className="small muted">Opprettet {d(o.created_at)}</div></td>
                <td>{o.users}</td><td>{o.items ?? 0}</td><td>{o.orders}</td><td>{o.invoices}</td><td>{d(o.last)}</td>
                <td><div className="row" style={{ justifyContent: "flex-end" }}>
                  <form action={openOrgAction}><input type="hidden" name="org" value={o.id} /><button className="btn dark sm">Åpne app</button></form>
                  <Link className="btn line sm" href={`/admin?fane=kunder&kunde=${o.id}`}>Detaljer</Link>
                </div></td>
              </tr>
            ))}
            {!orgs.length ? <tr><td colSpan={7} className="muted">Ingen kunder ennå.</td></tr> : null}
          </tbody>
        </table></div>
      </div>
    </>
  );
}

async function Customer({ id, meId }: { id: number; meId: number }) {
  const p = await db();
  const org = (await p.query("SELECT * FROM orgs WHERE id = $1", [id])).rows[0];
  if (!org) return <div className="card"><p>Fant ikke kunden. <Link href="/admin?fane=kunder">Tilbake</Link></p></div>;
  const [users, stats, tt, keys] = await Promise.all([
    userRows("u.org_id = $1", [id]),
    p.query(`SELECT col, count(*)::int AS n FROM docs WHERE org_id = $1 GROUP BY col`, [id]),
    p.query("SELECT created_at FROM integrations WHERE org_id = $1 AND provider = 'tripletex'", [id]),
    p.query("SELECT count(*)::int AS n FROM api_keys WHERE org_id = $1", [id]),
  ]);
  const n = (c: string) => stats.rows.find((r) => r.col === c)?.n ?? 0;
  const back = `/admin?fane=kunder&kunde=${id}`;
  const orgs = (await p.query("SELECT id, name FROM orgs ORDER BY name")).rows;
  return (
    <>
      <p><Link href="/admin?fane=kunder">← Alle kunder</Link></p>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}><h2 style={{ margin: 0 }}>{org.name}</h2>
          <div className="row">
            <form action={openOrgAction}><input type="hidden" name="org" value={id} /><button className="btn dark sm">Åpne app</button></form>
            <form action={loadPilotAction}><input type="hidden" name="org" value={id} /><input type="hidden" name="back" value={back} /><button className="btn line sm" title="Varer, leverandører og ukesalg fra About Contrasts">Last inn pilotdata</button></form>
          </div></div>
        <p className="small muted">Opprettet {d(org.created_at)} · {n("orders")} bestillinger · {n("counts")} tellinger · {n("waste")} svinnregistreringer · {n("invoices")} fakturaer · Tripletex {tt.rows[0] ? `koblet til ${d(tt.rows[0].created_at)}` : "ikke koblet til"} · {keys.rows[0].n} API-nøkler</p>
        <form action={updateOrgAction} className="fbform" style={{ marginTop: 10 }}>
          <input type="hidden" name="org" value={id} /><input type="hidden" name="back" value={back} />
          <label className="f">Navn<input name="name" defaultValue={org.name} required /></label>
          <label className="f wide">Internt notat (avtale, kontaktperson, pris)<textarea name="note" rows={2} defaultValue={org.note} /></label>
          <div className="row"><button className="btn dark sm">Lagre</button></div>
        </form>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Brukere hos {org.name} ({users.length})</h3>
        <form action={addUserAction} className="row" style={{ alignItems: "end", marginBottom: 12 }}>
          <input type="hidden" name="org" value={id} /><input type="hidden" name="back" value={back} />
          <label className="f" style={{ flex: 2, minWidth: 200 }}>E-post<input name="email" type="email" required /></label>
          <label className="f" style={{ flex: 1, minWidth: 140 }}>Navn<input name="name" /></label>
          <label className="f" style={{ minWidth: 130 }}>Rolle<select name="role" defaultValue="staff"><option value="staff">Ansatt</option><option value="owner">Leder</option></select></label>
          <button className="btn dark">Legg til bruker</button>
        </form>
        <UserList users={users} orgs={orgs} back={back} meId={meId} />
      </div>
      <details className="card">
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>Slett kunden</summary>
        <p className="small">Sletter kunden, alle brukerne og alle data (tellinger, bestillinger, svinn, fakturaer, filer). Kan ikke angres. Last gjerne ned en sikkerhetskopi i appen først.</p>
        <form action={deleteOrgAction} className="row"><input type="hidden" name="org" value={id} /><input type="hidden" name="back" value={back} /><input name="confirm" placeholder={`Skriv «${org.name}»`} style={{ maxWidth: 280 }} /><button className="btn red sm">Slett alt</button></form>
      </details>
    </>
  );
}

type URow = { id: number; email: string; name: string; role: string; is_root: boolean; is_developer: boolean; must_change_password: boolean; google: boolean; org_id: number | null; org: string | null; created_at: Date; last_login_at: Date | null; sessions: number };
async function userRows(where: string, args: unknown[]): Promise<URow[]> {
  const p = await db();
  return (await p.query(
    `SELECT u.id, u.email, u.name, u.role, u.is_root, u.is_developer, u.must_change_password, (u.google_sub IS NOT NULL) AS google, u.org_id, o.name AS org, u.created_at, u.last_login_at,
            (SELECT count(*)::int FROM sessions s WHERE s.user_id = u.id AND s.expires_at > now()) AS sessions
       FROM users u LEFT JOIN orgs o ON o.id = u.org_id
      ${where ? "WHERE " + where : ""} ORDER BY o.name NULLS FIRST, CASE u.role WHEN 'admin' THEN 0 WHEN 'owner' THEN 1 ELSE 2 END, u.name, u.email LIMIT 500`,
    args
  )).rows.map((r) => ({ ...r, id: Number(r.id), org_id: r.org_id == null ? null : Number(r.org_id) }));
}

function UserList({ users, orgs, back, meId }: { users: URow[]; orgs: { id: number; name: string }[]; back: string; meId: number }) {
  if (!users.length) return <p className="small muted">Ingen brukere.</p>;
  return (
    <div className="ulist">
      {users.map((u) => {
        const self = u.id === meId;
        const h = (name: string, value: string | number) => <input type="hidden" name={name} value={value} />;
        const hidden = <>{h("user", u.id)}{h("back", back)}{h("hash", `#u-${u.id}`)}</>;
        return (
          <details key={u.id} id={`u-${u.id}`} className="urow">
            <summary>
              <span className="uname"><b>{u.name || u.email}</b>{u.name ? <span className="small muted"> · {u.email}</span> : null}</span>
              <span className="row" style={{ gap: 6 }}>
                <span className={`tag ${u.role === "admin" ? "k-feil" : u.role === "owner" ? "s-planlagt" : ""}`}>{u.is_root ? "Hovedadmin" : ROLE[u.role]}</span>
                {u.is_developer && u.role !== "admin" ? <span className="tag k-forslag">Utvikler</span> : null}
                {u.must_change_password ? <span className="tag s-ny">Venter på nytt passord</span> : null}
                {u.google ? <span className="tag">Google</span> : null}
              </span>
              <span className="small muted">{u.org ?? (u.role === "admin" ? "Restoq" : "Ingen kunde")} · {u.last_login_at ? `sist innlogget ${dt(u.last_login_at)}` : "aldri innlogget"} · {u.sessions} aktiv(e) innlogging(er)</span>
            </summary>
            <div className="uedit">
              <form action={editUserAction} className="fbform">
                {hidden}
                <label className="f">Navn<input name="name" defaultValue={u.name} /></label>
                <label className="f">E-post<input name="email" type="email" defaultValue={u.email} required /></label>
                {u.role === "admin" ? <div className="small muted" style={{ alignSelf: "end" }}>Administrator i Restoq</div> : (
                  <>
                    <label className="f">Kunde<select name="org" defaultValue={u.org_id ?? ""}><option value="">Ingen (bare utviklersiden)</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
                    <label className="f">Rolle hos kunden<select name="role" defaultValue={u.role}><option value="staff">Ansatt</option><option value="owner">Leder</option></select></label>
                  </>
                )}
                <div className="row" style={{ alignItems: "end" }}><button className="btn dark sm">Lagre</button></div>
              </form>
              <div className="row" style={{ marginTop: 10 }}>
                {!u.is_root ? <form action={resetPasswordAction}>{hidden}<button className="btn line sm">Nytt midlertidig passord</button></form> : null}
                {!self && u.sessions ? <form action={logoutUserAction}>{hidden}<button className="btn line sm">Logg ut overalt</button></form> : null}
                {u.role !== "admin" ? <form action={toggleDeveloperAction}>{hidden}{h("on", u.is_developer ? "0" : "1")}<button className="btn line sm">{u.is_developer ? "Fjern utviklertilgang" : "Gi utviklertilgang"}</button></form> : null}
                {!u.is_root && !self && (u.role === "admin" || !u.org_id) ? <form action={toggleAdminAction}>{hidden}{h("on", u.role === "admin" ? "0" : "1")}<button className="btn line sm">{u.role === "admin" ? "Fjern administratorrolle" : "Gjør til administrator"}</button></form> : null}
                {!u.is_root && !self ? <form action={deleteUserAction}>{hidden}<button className="btn line sm danger-text">Slett bruker</button></form> : null}
              </div>
              <p className="small muted" style={{ marginTop: 6 }}>Opprettet {d(u.created_at)}. Nytt passord logger brukeren ut overalt.</p>
            </div>
          </details>
        );
      })}
    </div>
  );
}

async function Users({ sp, meId }: { sp: SP; meId: number }) {
  const p = await db();
  const q = String(sp.q ?? "").trim().slice(0, 80);
  const rolle = ["admin", "owner", "staff", "utvikler"].includes(sp.rolle ?? "") ? sp.rolle! : "";
  const where: string[] = [];
  const args: unknown[] = [];
  if (q) where.push(`(u.email ILIKE $${args.push(`%${q}%`)} OR u.name ILIKE $${args.length} OR o.name ILIKE $${args.length})`);
  if (rolle === "utvikler") where.push("u.is_developer");
  else if (rolle) where.push(`u.role = $${args.push(rolle)}`);
  const [users, orgs] = await Promise.all([userRows(where.join(" AND "), args), p.query("SELECT id, name FROM orgs ORDER BY name")]);
  const back = `/admin?fane=brukere${q ? `&q=${encodeURIComponent(q)}` : ""}${rolle ? `&rolle=${rolle}` : ""}`;
  return (
    <>
      <div className="card">
        <form className="row" style={{ alignItems: "end" }}>
          <input type="hidden" name="fane" value="brukere" />
          <label className="f" style={{ flex: 2, minWidth: 220 }}>Søk etter navn, e-post eller kunde<input name="q" defaultValue={q} /></label>
          <label className="f" style={{ minWidth: 160 }}>Rolle<select name="rolle" defaultValue={rolle}><option value="">Alle</option><option value="owner">Ledere</option><option value="staff">Ansatte</option><option value="utvikler">Utviklere</option><option value="admin">Administratorer</option></select></label>
          <button className="btn dark">Søk</button>
        </form>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Brukere ({users.length})</h3>
        <p className="small muted">Trykk på en bruker for å endre navn, e-post, kunde og rolle, lage nytt passord, logge ut eller slette.</p>
        <UserList users={users} orgs={orgs.rows} back={back} meId={meId} />
      </div>
      <div className="grid2" style={{ alignItems: "start" }}>
        <div className="card">
          <h3 style={{ marginTop: 0, marginBottom: 12 }}>Legg til bruker hos en kunde</h3>
          <form action={addUserAction} className="fbform" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <input type="hidden" name="back" value={back} />
            <label className="f">Kunde<select name="org" required>{orgs.rows.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
            <label className="f">Rolle<select name="role" defaultValue="staff"><option value="staff">Ansatt</option><option value="owner">Leder</option></select></label>
            <label className="f">E-post<input name="email" type="email" required /></label>
            <label className="f">Navn<input name="name" /></label>
            <div className="row"><button className="btn dark sm">Legg til</button></div>
          </form>
        </div>
        <div className="card" id="utviklere">
          <h3 style={{ marginTop: 0, marginBottom: 6 }}>Ny utvikler</h3>
          <p className="small muted" style={{ marginBottom: 12 }}>Utviklere ser tilbakemeldinger, feillogg og oversettelser på /utvikler. Finnes ikke e-posten, lages en konto uten tilgang til kundenes data.</p>
          <form action={developerAction} className="fbform" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <input type="hidden" name="back" value={back} />
            <label className="f">E-post<input name="email" type="email" required /></label>
            <label className="f">Navn<input name="name" /></label>
            <div className="row"><button className="btn dark sm">Gi utviklertilgang</button></div>
          </form>
        </div>
      </div>
    </>
  );
}

async function Leads({ vis }: { vis?: string }) {
  const p = await db();
  const all = vis === "alle";
  const leads = (await p.query(`SELECT l.*, o.name AS org FROM leads l LEFT JOIN orgs o ON o.id = l.org_id ${all ? "" : "WHERE NOT l.handled"} ORDER BY l.created_at DESC LIMIT 200`)).rows;
  const back = `/admin?fane=henvendelser${all ? "&vis=alle" : ""}`;
  return (
    <>
      <nav className="devfilters"><Link href="/admin?fane=henvendelser" aria-current={!all ? "page" : undefined}>Ubehandlede</Link><Link href="/admin?fane=henvendelser&vis=alle" aria-current={all ? "page" : undefined}>Alle</Link></nav>
      {!leads.length ? <div className="card"><p className="muted">Ingen henvendelser her. De kommer fra «Book en demo» på forsiden.</p></div> : null}
      {leads.map((l) => (
        <article key={l.id} id={`lead-${l.id}`} className={`card fb ${l.handled ? "st-ferdig" : "st-ny"}`}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div><h3 style={{ margin: 0 }}>{l.company || l.name}</h3><div className="small muted">{dt(l.created_at)} · {l.venues ? `${l.venues} steder` : "antall steder ikke oppgitt"}{l.org ? ` · kunde: ${l.org}` : ""}</div></div>
            <span className={`tag ${l.handled ? "s-ferdig" : "s-ny"}`}>{l.handled ? "Fulgt opp" : "Ny"}</span>
          </div>
          <p className="small"><b>{l.name}</b> · <a href={`mailto:${l.email}`}>{l.email}</a>{l.phone ? <> · <a href={`tel:${l.phone}`}>{l.phone}</a></> : null}</p>
          {l.message ? <p className="fbmsg" style={{ fontSize: 16 }}>{l.message}</p> : null}
          <form action={leadAction} className="fbform">
            <input type="hidden" name="id" value={l.id} /><input type="hidden" name="back" value={back} /><input type="hidden" name="hash" value={`#lead-${l.id}`} />
            <label className="f wide">Notat (vises bare her)<textarea name="note" rows={2} defaultValue={l.note} placeholder="F.eks. demo avtalt torsdag kl. 10" /></label>
            <label className="row" style={{ gap: 8, fontWeight: 600 }}><input type="checkbox" name="handled" value="1" defaultChecked={l.handled} style={{ width: 20, minHeight: 20 }} /> Fulgt opp</label>
            <div className="row"><button className="btn dark sm">Lagre</button></div>
          </form>
          {!l.org_id ? (
            <details><summary className="small" style={{ cursor: "pointer", fontWeight: 600 }}>Opprett som kunde</summary>
              <form action={createOrgAction} className="row" style={{ alignItems: "end", marginTop: 8 }}>
                <input type="hidden" name="lead" value={l.id} /><input type="hidden" name="back" value="/admin?fane=kunder" />
                <label className="f" style={{ flex: 2 }}>Kunde<input name="name" defaultValue={l.company || l.name} required /></label>
                <label className="f" style={{ flex: 2 }}>Leders e-post<input name="email" type="email" defaultValue={l.email} required /></label>
                <label className="f" style={{ flex: 1 }}>Leders navn<input name="owner" defaultValue={l.name} /></label>
                <button className="btn dark sm">Opprett kunde</button>
              </form>
            </details>
          ) : null}
          <form action={leadAction}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="op" value="delete" /><input type="hidden" name="back" value={back} /><button className="btn line sm">Slett henvendelsen</button></form>
        </article>
      ))}
    </>
  );
}

async function Log({ q }: { q?: string }) {
  const s = String(q ?? "").trim().slice(0, 80);
  const p = await db();
  const rows = (await p.query(
    `SELECT a.*, o.name AS org FROM audit a LEFT JOIN orgs o ON o.id = a.org_id
      ${s ? "WHERE a.actor ILIKE $1 OR a.action ILIKE $1 OR a.detail ILIKE $1 OR o.name ILIKE $1" : ""} ORDER BY a.created_at DESC LIMIT 300`,
    s ? [`%${s}%`] : []
  )).rows;
  return (
    <div className="card">
      <form className="row" style={{ alignItems: "end", marginBottom: 12 }}><input type="hidden" name="fane" value="logg" /><label className="f" style={{ flex: 1 }}>Søk (bruker, handling, kunde)<input name="q" defaultValue={s} /></label><button className="btn dark">Søk</button></form>
      <div style={{ overflowX: "auto" }}><table>
        <thead><tr><th>Tid</th><th>Hvem</th><th>Kunde</th><th>Hendelse</th></tr></thead>
        <tbody>{rows.map((a) => <tr key={a.id}><td className="small" style={{ whiteSpace: "nowrap" }}>{dt(a.created_at)}</td><td className="small">{a.actor ?? "–"}</td><td className="small">{a.org ?? ""}</td><td className="small">{a.action}{a.detail ? ` – ${a.detail}` : ""}</td></tr>)}</tbody>
      </table></div>
      <p className="small muted">Viser de siste 300 hendelsene: innlogginger, mislykkede innlogginger, endringer i oppsett, brukere, fakturaer og kunder.</p>
    </div>
  );
}

async function Setup({ email }: { email: string }) {
  const p = await db();
  const t0 = Date.now();
  const size = (await p.query("SELECT pg_size_pretty(pg_database_size(current_database())) AS s, (SELECT count(*)::int FROM docs) AS docs, (SELECT coalesce(sum(size),0)::bigint FROM files) AS files")).rows[0];
  const ms = Date.now() - t0;
  const Pill = ({ ok, on = "Satt opp", off = "Ikke satt opp" }: { ok: boolean; on?: string; off?: string }) => <span className={`tag ${ok ? "s-ferdig" : "k-feil"}`}>{ok ? on : off}</span>;
  return (
    <>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Tjenester</h3>
        <table><tbody>
          <tr><td>Versjon som kjører</td><td><code>{(process.env.RENDER_GIT_COMMIT ?? "lokal").slice(0, 7)}</code></td></tr>
          <tr><td>Database</td><td><Pill ok on="OK" /> {ms} ms · {size.s} · {nf.format(size.docs)} dokumenter · filer {nf.format(Math.round(Number(size.files) / 1024 / 1024))} MB</td></tr>
          <tr><td>E-post (Resend)</td><td><Pill ok={mailEnabled()} /> {process.env.MAIL_FROM ?? ""}</td></tr>
          <tr><td>Logg inn med Google</td><td><Pill ok={googleEnabled()} /></td></tr>
          <tr><td>Tripletex</td><td><Pill ok={tripletexConfigured()} on={process.env.TRIPLETEX_ENV === "prod" ? "Produksjon" : "Testmiljø"} /></td></tr>
          <tr><td>Automatisk oversettelse (Claude)</td><td><Pill ok={aiTranslateEnabled()} /></td></tr>
          <tr><td>Henvendelser sendes til</td><td>{process.env.LEADS_EMAIL || process.env.ADMIN_EMAIL || "–"}</td></tr>
          <tr><td>Selskap i bunntekst og personvern</td><td>{process.env.LEGAL_ENTITY ? `${process.env.LEGAL_ENTITY}${process.env.LEGAL_ORGNR ? ` (${process.env.LEGAL_ORGNR})` : ""}` : <Pill ok={false} off="Mangler (LEGAL_ENTITY)" />}</td></tr>
        </tbody></table>
        <p className="small muted">Viser bare om tjenestene er satt opp – aldri nøkler eller hemmeligheter. Endres under Environment i Render.</p>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0, marginBottom: 12 }}>Test e-post</h3>
        <form action={testMailAction} className="row" style={{ alignItems: "end" }}>
          <input type="hidden" name="back" value="/admin?fane=oppsett" />
          <label className="f" style={{ flex: 1 }}>Send test til<input name="to" type="email" defaultValue={email} /></label>
          <button className="btn dark" disabled={!mailEnabled()}>Send test</button>
        </form>
      </div>
    </>
  );
}
