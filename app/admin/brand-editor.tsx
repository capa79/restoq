"use client";
import { useState } from "react";
import { refreshBrandAction, saveBrandAction } from "./actions";

type B = { head: string; accent: string; logo: string | null; tagline?: string; name?: string; palette?: string[]; font?: string; source?: { themeColor?: string; title?: string; logoFrom?: string; fetchedAt?: string; error?: string } };
const ink = (h: string) => { const x = h.replace("#", ""); const [r, g, b] = [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)); return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#141A18" : "#FFFFFF"; };

export function BrandEditor({ orgId, orgName, back, brand, slug, website, hasHero }: { orgId: number; orgName: string; back: string; brand: B; slug: string; website: string; hasHero: boolean }) {
  const [head, setHead] = useState(brand.head);
  const [accent, setAccent] = useState(brand.accent);
  const [logo, setLogo] = useState<string | null>(brand.logo);
  const [target, setTarget] = useState<"head" | "accent">("accent");
  const [busy, setBusy] = useState(false);
  const name = brand.name || orgName;
  const pick = (c: string) => (target === "head" ? setHead(c) : setAccent(c));
  const palette = [...new Set([...(brand.palette ?? []), brand.source?.themeColor, "#141a18", "#ffffff"].filter(Boolean) as string[])];
  const h = <><input type="hidden" name="org" value={orgId} /><input type="hidden" name="back" value={back} /><input type="hidden" name="hash" value="#utseende" /></>;

  return (
    <div className="card" id="utseende">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>Utseende og stedets side</h3>
        {slug ? <a className="btn dark sm" href={`/v/${slug}`} target="_blank" rel="noopener">Åpne /v/{slug} ↗</a> : null}
      </div>
      <p className="small muted" style={{ marginTop: 6 }}>
        Hentet fra logoen{website ? <> og <a href={website} target="_blank" rel="noopener noreferrer">{website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</a></> : null}
        {brand.source?.fetchedAt ? ` ${new Date(brand.source.fetchedAt).toLocaleDateString("nb-NO")}` : ""}. Ansatte logger inn på stedets side og kan legge den på hjemskjermen som en egen app.
        {brand.source?.error ? <><br /><b>Merk:</b> {brand.source.error}</> : null}
      </p>

      <div className="bprev">
        <div className="bprev-app">
          <div className="bprev-top" style={{ background: head, color: ink(head), borderBottomColor: accent }}>
            {logo ? <img src={logo} alt="" /> : <b>{name}</b>}
            <span className="bprev-pw">powered by <b>Restoq</b></span>
          </div>
          <div className="bprev-body">
            <div className="bprev-line" /><div className="bprev-line s" />
            <span className="bprev-btn" style={{ background: accent, color: ink(accent) }}>Lag bestilling</span>
          </div>
          <div className="small muted bprev-cap">Appen</div>
        </div>
        <div className="bprev-venue" style={{ background: head, color: ink(head) }}>
          {hasHero ? <img className="bprev-bg" src={`/v/${slug}/bilde`} alt="" /> : null}
          <div className="bprev-shade" style={{ background: `linear-gradient(180deg, ${head}88, ${head}ee)` }} />
          <span className="bprev-badge" style={{ background: head }}>{logo ? <img src={logo} alt="" /> : <b>{name}</b>}</span>
          <div className="bprev-h">{name}</div>
          <span className="bprev-btn" style={{ background: accent, color: ink(accent) }}>Logg inn</span>
          <div className="small bprev-cap" style={{ color: ink(head), opacity: 0.8 }}>Stedets side</div>
        </div>
        <div className="bprev-icon" style={{ background: head }}>{logo ? <img src={logo} alt="" /> : <b style={{ color: ink(head) }}>{name[0]}</b>}<div className="small muted bprev-cap" style={{ position: "absolute", bottom: -24 }}>App-ikon</div></div>
      </div>

      <form action={saveBrandAction} className="fbform" style={{ marginTop: 28 }} onSubmit={() => setBusy(true)}>
        {h}
        <div className="f wide">
          <div className="row" style={{ gap: 8 }}>
            <span className="small" style={{ fontWeight: 600, color: "var(--muted)" }}>Foreslåtte farger – trykk for å bruke som</span>
            <select value={target} onChange={(e) => setTarget(e.target.value as "head" | "accent")} style={{ width: "auto", minHeight: 34, padding: "4px 8px" }}>
              <option value="accent">aksentfarge</option><option value="head">topplinjefarge</option>
            </select>
          </div>
          <div className="row" style={{ gap: 6, marginTop: 8 }}>
            {palette.map((c) => <button key={c} type="button" className="bswatch" title={c} style={{ background: c }} onClick={() => pick(c)} aria-label={`Bruk ${c}`} />)}
          </div>
        </div>
        <label className="f">Topplinje og ikon<span className="row" style={{ gap: 8 }}><input type="color" name="head" value={head} onChange={(e) => setHead(e.target.value)} style={{ width: 56, padding: 2 }} /><code>{head}</code></span></label>
        <label className="f">Aksent (knapper og streker)<span className="row" style={{ gap: 8 }}><input type="color" name="accent" value={accent} onChange={(e) => setAccent(e.target.value)} style={{ width: 56, padding: 2 }} /><code>{accent}</code></span></label>
        <label className="f">Ny logo<input type="file" name="logo" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onload = () => setLogo(String(r.result)); r.readAsDataURL(f); } }} /></label>
        <label className="f">Navn som vises<input name="display" defaultValue={name} /></label>
        <label className="f">Adresse: restoq.no/v/<input name="slug" defaultValue={slug} pattern="[a-zA-Z0-9\- ]{2,40}" /></label>
        <label className="f wide">Tekst på stedets side<textarea name="tagline" rows={2} maxLength={220} defaultValue={brand.tagline ?? ""} placeholder="F.eks. stedets egen beskrivelse fra hjemmesiden" /></label>
        <div className="row wide">
          {brand.logo ? <label className="row small" style={{ gap: 6 }}><input type="checkbox" name="removeLogo" value="1" style={{ width: 18, minHeight: 18 }} /> Fjern logo</label> : null}
          {hasHero ? <label className="row small" style={{ gap: 6 }}><input type="checkbox" name="removeHero" value="1" style={{ width: 18, minHeight: 18 }} /> Fjern forsidebildet</label> : null}
          <div style={{ flex: 1 }} />
          <button className="btn dark sm" disabled={busy}>{busy ? "Lagrer …" : "Lagre utseende"}</button>
        </div>
      </form>

      <details style={{ marginTop: 16 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Hent på nytt fra hjemmesiden</summary>
        <form action={refreshBrandAction} className="fbform">
          {h}
          <label className="f wide">Hjemmeside<input name="website" defaultValue={website} placeholder="aboutcontrasts.no" required /></label>
          <label className="row small wide" style={{ gap: 6 }}><input type="checkbox" name="keepLogo" value="1" defaultChecked={!!brand.logo} style={{ width: 18, minHeight: 18 }} /> Behold nåværende logo (bare farger, tekst og bilde hentes)</label>
          <label className="row small wide" style={{ gap: 6 }}><input type="checkbox" name="consent" value="1" defaultChecked style={{ width: 18, minHeight: 18 }} /> Kunden har godkjent at logo og bilde fra hjemmesiden brukes i Restoq</label>
          <div className="row wide"><button className="btn line sm">Hent og bruk</button><span className="small muted">Overskriver farger og tekst over.</span></div>
        </form>
      </details>
    </div>
  );
}
