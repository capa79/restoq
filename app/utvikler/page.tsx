import Link from "next/link";
import { db } from "@/lib/db";
import { requireDeveloper } from "@/lib/session";
import { mailEnabled } from "@/lib/mail";
import { googleEnabled } from "@/lib/google-auth";
import { tripletexConfigured } from "@/lib/tripletex";
import { logoutAction } from "../auth-actions";
import { browser, FEEDBACK_KINDS, FEEDBACK_PRIORITIES, FEEDBACK_STATUSES, kindLabel, OPEN_STATUSES, priorityLabel, statusLabel } from "@/lib/feedback";
import { clearErrorsAction, deleteErrorAction, deleteFeedbackAction, deleteSimilarErrorsAction, updateFeedbackAction } from "./actions";
import { CopyButton } from "./copy-button";

export const metadata = { title: "Utvikler – Restoq", robots: { index: false } };
export const dynamic = "force-dynamic";

const fmt = (d: Date | string | null) => (d ? new Intl.DateTimeFormat("nb-NO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Oslo" }).format(new Date(d)) : "–");
type SP = { fane?: string; status?: string; type?: string; kunde?: string; meg?: string; ok?: string };

export default async function Utvikler({ searchParams }: { searchParams: Promise<SP> }) {
  const dev = await requireDeveloper();
  const sp = await searchParams;
  const fane = ["feillogg", "status"].includes(sp.fane ?? "") ? sp.fane! : "tilbakemeldinger";
  const p = await db();
  const [newFb, err24] = await Promise.all([
    p.query("SELECT count(*)::int AS n FROM feedback WHERE status = 'ny'"),
    p.query("SELECT count(*)::int AS n FROM error_log WHERE at > now() - interval '24 hours'"),
  ]);
  return (
    <div className="site">
      <header className="nav"><div className="wrap"><Link href="/" className="logo">Restoq utvikler</Link><div style={{ flex: 1 }} />
        {dev.role === "admin" ? <Link className="btn ghost sm" href="/admin">Admin</Link> : null}
        {dev.org_id ? <Link className="btn ghost sm" href="/app">Appen</Link> : null}
        <span className="small" style={{ opacity: 0.7 }}>{dev.email}</span><form action={logoutAction}><button className="btn ghost sm">Logg ut</button></form></div></header>
      <main className="admin">
        <nav className="devtabs" aria-label="Utvikler">
          <Link href="/utvikler" aria-current={fane === "tilbakemeldinger" ? "page" : undefined}>Tilbakemeldinger {newFb.rows[0].n ? <b>{newFb.rows[0].n} nye</b> : null}</Link>
          <Link href="/utvikler?fane=feillogg" aria-current={fane === "feillogg" ? "page" : undefined}>Feillogg {err24.rows[0].n ? <b>{err24.rows[0].n} siste døgn</b> : null}</Link>
          <Link href="/utvikler?fane=status" aria-current={fane === "status" ? "page" : undefined}>Systemstatus</Link>
        </nav>
        {sp.ok ? <div className="note ok">{sp.ok}</div> : null}
        {fane === "feillogg" ? <Errors /> : fane === "status" ? <Status /> : <Feedback sp={sp} devId={dev.id} />}
      </main>
    </div>
  );
}

async function Feedback({ sp, devId }: { sp: SP; devId: number }) {
  const status = sp.status === "alle" || FEEDBACK_STATUSES.some((s) => s.id === sp.status) ? sp.status! : "apne";
  const type = FEEDBACK_KINDS.some((k) => k.id === sp.type) ? sp.type! : "";
  const kunde = /^\d+$/.test(sp.kunde ?? "") ? Number(sp.kunde) : null;
  const mine = sp.meg === "1";
  const p = await db();
  const where: string[] = [];
  const args: unknown[] = [];
  if (status === "apne") where.push(`f.status = ANY($${args.push(OPEN_STATUSES)})`);
  else if (status !== "alle") where.push(`f.status = $${args.push(status)}`);
  if (type) where.push(`f.kind = $${args.push(type)}`);
  if (kunde) where.push(`f.org_id = $${args.push(kunde)}`);
  if (mine) where.push(`f.assigned_to = $${args.push(devId)}`);
  const [rows, counts, devs, orgs] = await Promise.all([
    p.query(
      `SELECT f.*, o.name AS org, NULLIF(u.name, '') AS tester, u.email AS tester_email, u.role AS tester_role, NULLIF(a.name, '') AS assignee, a.email AS assignee_email,
              ARRAY(SELECT i.id FROM feedback_images i WHERE i.feedback_id = f.id ORDER BY i.id) AS images
         FROM feedback f LEFT JOIN orgs o ON o.id = f.org_id LEFT JOIN users u ON u.id = f.user_id LEFT JOIN users a ON a.id = f.assigned_to
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY CASE f.priority WHEN 'hoy' THEN 0 WHEN 'middels' THEN 1 WHEN 'lav' THEN 2 ELSE 3 END, f.created_at DESC LIMIT 300`,
      args
    ),
    p.query("SELECT status, count(*)::int AS n FROM feedback GROUP BY status"),
    p.query("SELECT id, name, email FROM users WHERE is_developer OR role = 'admin' ORDER BY name, email"),
    p.query("SELECT DISTINCT o.id, o.name FROM feedback f JOIN orgs o ON o.id = f.org_id ORDER BY o.name"),
  ]);
  const n = (s: string) => counts.rows.find((r) => r.status === s)?.n ?? 0;
  const link = (o: Partial<Record<"status" | "type" | "kunde" | "meg", string>>) => {
    const q = new URLSearchParams();
    const st = o.status ?? status; if (st !== "apne") q.set("status", st);
    const ty = o.type ?? type; if (ty) q.set("type", ty);
    const ku = o.kunde ?? (kunde ? String(kunde) : ""); if (ku) q.set("kunde", ku);
    const me = o.meg ?? (mine ? "1" : ""); if (me) q.set("meg", me);
    const s = q.toString();
    return `/utvikler${s ? "?" + s : ""}`;
  };
  const here = link({});
  return (
    <>
      <p className="muted">Tilbakemeldinger fra testerne, sendt med «Gi tilbakemelding» i appen. Sett status og prioritet, tildel og skriv interne notater. «Kopier som oppgave» gir en ferdig beskrivelse å lime inn hos utvikleren eller i Claude Code.</p>
      <nav className="devfilters" aria-label="Status">
        <Link href={link({ status: "apne" })} aria-current={status === "apne" ? "page" : undefined}>Åpne <b>{OPEN_STATUSES.reduce((a, s) => a + n(s), 0)}</b></Link>
        {FEEDBACK_STATUSES.map((s) => <Link key={s.id} href={link({ status: s.id })} aria-current={status === s.id ? "page" : undefined}>{s.label} <b>{n(s.id)}</b></Link>)}
        <Link href={link({ status: "alle" })} aria-current={status === "alle" ? "page" : undefined}>Alle</Link>
      </nav>
      <nav className="devfilters sub" aria-label="Type og kunde">
        <Link href={link({ type: "" })} aria-current={!type ? "page" : undefined}>Alle typer</Link>
        {FEEDBACK_KINDS.map((k) => <Link key={k.id} href={link({ type: k.id })} aria-current={type === k.id ? "page" : undefined}>{k.label}</Link>)}
        <span className="sep" />
        <Link href={link({ kunde: "" })} aria-current={!kunde ? "page" : undefined}>Alle kunder</Link>
        {orgs.rows.map((o) => <Link key={o.id} href={link({ kunde: String(o.id) })} aria-current={kunde === Number(o.id) ? "page" : undefined}>{o.name}</Link>)}
        <span className="sep" />
        <Link href={link({ meg: mine ? "" : "1" })} aria-current={mine ? "page" : undefined}>{mine ? "✓ " : ""}Tildelt meg</Link>
      </nav>
      {rows.rows.length === 0 ? <div className="card"><p className="muted">Ingen tilbakemeldinger her.</p></div> : null}
      {rows.rows.map((f) => {
        const task = `## Restoq #${f.id}: ${kindLabel(f.kind)}\n\n**Fra tester${f.org ? ` hos ${f.org}` : ""}:**\n> ${String(f.message).replace(/\n/g, "\n> ")}\n\n- Side i appen: ${f.path || "ukjent"}\n- Nettleser: ${browser(f.user_agent)}\n- Versjon: ${f.version || "ukjent"}\n- Tidspunkt: ${fmt(f.created_at)}${f.images.length ? `\n- ${f.images.length} skjermbilde(r) i Restoq: /utvikler#fb-${f.id}` : ""}${f.context ? `\n\n**Kontekst fra appen:**\n\`\`\`\n${f.context}\n\`\`\`` : ""}${f.dev_note ? `\n\n**Internt notat:** ${f.dev_note}` : ""}\n\n**Oppgave:** Finn årsaken, rett feilen i capa79/restoq og beskriv hvordan det er testet.`;
        return (
          <article key={f.id} id={`fb-${f.id}`} className={`card fb st-${f.status}`}>
            <div className="row">
              <span className={`tag k-${f.kind}`}>{kindLabel(f.kind)}</span>
              <span className={`tag s-${f.status}`}>{statusLabel(f.status)}</span>
              {f.priority ? <span className={`tag p-${f.priority}`}>Prioritet: {priorityLabel(f.priority)}</span> : null}
              <span className="small muted">#{f.id} · {fmt(f.created_at)} · {f.tester ?? "Tester"}{f.tester_role === "owner" ? " (leder)" : ""}{f.org ? ` · ${f.org}` : ""}</span>
            </div>
            <p className="fbmsg">{f.message}</p>
            <p className="small muted">Side: <code>{f.path || "–"}</code> · {browser(f.user_agent)}{f.version ? ` · versjon ${f.version}` : ""}{f.assignee || f.assignee_email ? ` · Tildelt: ${f.assignee ?? f.assignee_email}` : ""}{f.updated_at ? ` · Endret ${fmt(f.updated_at)} av ${f.updated_by}` : ""}</p>
            {f.images.length ? <div className="thumbs">{f.images.map((img: string, i: number) => <a key={img} href={`/api/dev/feedback-image/${img}`} target="_blank" rel="noopener noreferrer"><img src={`/api/dev/feedback-image/${img}`} alt={`Skjermbilde ${i + 1} til #${f.id}`} loading="lazy" /></a>)}</div> : null}
            {f.context ? <details><summary className="small">Kontekst fra appen (siste feil, kunde, rolle)</summary><pre className="stack">{f.context}</pre></details> : null}
            <div className="row" style={{ marginTop: 8 }}>
              <CopyButton text={task} />
              {f.tester_email ? <a className="btn line sm" href={`mailto:${f.tester_email}?subject=${encodeURIComponent(`Restoq: tilbakemeldingen din #${f.id}`)}`}>Svar testeren</a> : null}
            </div>
            <details className="fbedit" open={f.status === "ny"}>
              <summary>Behandle</summary>
              <form action={updateFeedbackAction} className="fbform">
                <input type="hidden" name="id" value={f.id} /><input type="hidden" name="back" value={here} /><input type="hidden" name="hash" value={`#fb-${f.id}`} />
                <label className="f">Status<select name="status" defaultValue={f.status}>{FEEDBACK_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
                <label className="f">Prioritet<select name="priority" defaultValue={f.priority}>{FEEDBACK_PRIORITIES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
                <label className="f">Tildelt<select name="assigned" defaultValue={f.assigned_to ?? ""}><option value="">Ingen</option>{devs.rows.map((d) => <option key={d.id} value={String(d.id)}>{d.name || d.email}{Number(d.id) === devId ? " (meg)" : ""}</option>)}</select></label>
                <label className="f wide">Internt notat<textarea name="dev_note" rows={3} maxLength={4000} defaultValue={f.dev_note} placeholder="Årsak, løsning eller lenke til commit. Vises ikke for testeren." /></label>
                <div className="row"><button className="btn dark sm">Lagre</button></div>
              </form>
              <form action={deleteFeedbackAction} style={{ marginTop: 8 }}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="back" value={here} /><button className="btn line sm">Slett tilbakemeldingen</button></form>
            </details>
          </article>
        );
      })}
      <p className="small muted">Tilbakemeldinger kan inneholde personopplysninger. Bruk dem bare til å forbedre Restoq.</p>
    </>
  );
}

async function Errors() {
  const p = await db();
  const [rows, day, week, top] = await Promise.all([
    p.query("SELECT e.*, o.name AS org FROM error_log e LEFT JOIN orgs o ON o.id = e.org_id ORDER BY e.at DESC LIMIT 150"),
    p.query("SELECT count(*)::int AS n FROM error_log WHERE at > now() - interval '24 hours'"),
    p.query("SELECT count(*)::int AS n FROM error_log WHERE at > now() - interval '7 days'"),
    p.query("SELECT left(message, 140) AS message, count(*)::int AS n, max(at) AS last FROM error_log GROUP BY 1 ORDER BY n DESC LIMIT 6"),
  ]);
  const back = "/utvikler?fane=feillogg";
  return (
    <>
      <div className="kpis">
        <div className="card"><span className="small muted">Siste døgn</span><b>{day.rows[0].n}</b></div>
        <div className="card"><span className="small muted">Siste 7 dager</span><b>{week.rows[0].n}</b></div>
        <div className="card"><span className="small muted">Lagres i</span><b>30 dager</b></div>
      </div>
      {top.rows.length ? (
        <div className="card"><h3 style={{ marginTop: 0 }}>Vanligste feil</h3>
          <table><thead><tr><th>Feil</th><th>Antall</th><th>Sist</th><th /></tr></thead>
            <tbody>{top.rows.map((t) => <tr key={t.message}><td>{t.message}</td><td>{t.n}</td><td>{fmt(t.last)}</td><td><form action={deleteSimilarErrorsAction}><input type="hidden" name="message" value={t.message} /><input type="hidden" name="back" value={back} /><button className="btn line sm">Alle løst</button></form></td></tr>)}</tbody>
          </table></div>
      ) : null}
      {rows.rows.length === 0 ? <div className="card"><p className="muted">Ingen feil registrert. Feil på serveren og i nettleseren logges her automatisk.</p></div> : (
        <div className="card">
          {rows.rows.map((e) => (
            <div key={e.id} className="errrow">
              <details style={{ flex: 1, minWidth: 0 }}>
                <summary><span className={`tag ${e.source === "server" ? "k-feil" : ""}`}>{e.source === "server" ? "Server" : "Nettleser"}</span> {String(e.message).slice(0, 220)}
                  <span className="small muted" style={{ display: "block" }}>{fmt(e.at)} · {e.path || "–"}{e.org ? ` · ${e.org}` : ""}{e.user_agent ? ` · ${browser(e.user_agent)}` : ""}</span></summary>
                {e.stack ? <pre className="stack">{e.stack}</pre> : null}
                <CopyButton label="Kopier som oppgave" text={`## Feil i Restoq (${e.source === "server" ? "server" : "nettleser"})\n\n${e.message}\n\n- Side: ${e.path || "ukjent"}\n- Tidspunkt: ${fmt(e.at)}\n- Nettleser: ${browser(e.user_agent)}\n\n\`\`\`\n${e.stack || "(ingen stack)"}\n\`\`\`\n\n**Oppgave:** Finn årsaken og rett feilen i capa79/restoq.`} />
              </details>
              <form action={deleteErrorAction}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="back" value={back} /><button className="btn line sm">Løst</button></form>
            </div>
          ))}
          <form action={clearErrorsAction} style={{ marginTop: 12 }}><input type="hidden" name="back" value={back} /><button className="btn line sm">Tøm feilloggen</button></form>
        </div>
      )}
    </>
  );
}

const Pill = ({ ok, on = "På", off = "Av" }: { ok: boolean; on?: string; off?: string }) => <span className={`tag ${ok ? "s-ferdig" : "k-feil"}`}>{ok ? on : off}</span>;

async function Status() {
  const p = await db();
  const t0 = Date.now();
  const [orgs, users, fb, inv, leads] = await Promise.all([
    p.query("SELECT count(*)::int AS n FROM orgs"),
    p.query("SELECT count(*)::int AS n, count(*) FILTER (WHERE last_login_at > now() - interval '7 days')::int AS active FROM users WHERE role <> 'admin'"),
    p.query("SELECT count(*) FILTER (WHERE status = 'ny')::int AS ny, count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS week FROM feedback"),
    p.query("SELECT count(*)::int AS n, count(*) FILTER (WHERE data->>'status' = 'avvik')::int AS avvik FROM docs WHERE col = 'invoices'"),
    p.query("SELECT count(*) FILTER (WHERE NOT handled)::int AS n FROM leads"),
  ]);
  const ms = Date.now() - t0;
  return (
    <>
      <div className="kpis">
        <div className="card"><span className="small muted">Kunder</span><b>{orgs.rows[0].n}</b></div>
        <div className="card"><span className="small muted">Brukere</span><b>{users.rows[0].n}</b><span className="small muted">{users.rows[0].active} aktive siste 7 dager</span></div>
        <div className="card"><span className="small muted">Nye tilbakemeldinger</span><b>{fb.rows[0].ny}</b><span className="small muted">{fb.rows[0].week} siste 7 dager</span></div>
        <div className="card"><span className="small muted">Fakturaer</span><b>{inv.rows[0].n}</b><span className="small muted">{inv.rows[0].avvik} med avvik</span></div>
      </div>
      <div className="card"><h3 style={{ marginTop: 0 }}>Tjenester</h3>
        <table><tbody>
          <tr><td>Versjon som kjører</td><td><code>{(process.env.RENDER_GIT_COMMIT ?? "lokal").slice(0, 7)}</code></td></tr>
          <tr><td>Database</td><td><Pill ok on="OK" /> svarte på {ms} ms</td></tr>
          <tr><td>E-post (Resend)</td><td><Pill ok={mailEnabled()} /></td></tr>
          <tr><td>Logg inn med Google</td><td><Pill ok={googleEnabled()} /></td></tr>
          <tr><td>Tripletex</td><td><Pill ok={tripletexConfigured()} on={process.env.TRIPLETEX_ENV === "prod" ? "Produksjon" : "Testmiljø"} /></td></tr>
          <tr><td>Ubesvarte henvendelser fra forsiden</td><td>{leads.rows[0].n}</td></tr>
        </tbody></table>
        <p className="small muted">Viser bare om tjenestene er slått på – aldri nøkler eller hemmeligheter.</p>
      </div>
    </>
  );
}
