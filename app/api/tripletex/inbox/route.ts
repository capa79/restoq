import { apiUser, canManage, json } from "@/lib/api-auth";
import { audit } from "@/lib/db";
import { getDoc, putDoc } from "@/lib/invoices";
import { syncTripletexInbox, type State } from "@/lib/ttx-inbox";

/** Henter fakturaer fra bilagsmottaket i Tripletex. Alle innloggede kan starte henting, men høyst hvert 10. minutt (administrator kan tvinge). */
export async function POST(req: Request) {
  const u = await apiUser(req, true);
  if (u instanceof Response) return u;
  const b = await req.json().catch(() => ({}));
  // Velg bort (eller ta inn igjen) en leverandør som ikke er registrert i Restoq
  if (b.ignore || b.unignore) {
    if (!canManage(u)) return json({ error: "Bare leder kan endre dette." }, 403);
    const x = b.ignore ?? b.unignore;
    const name = String(x?.name ?? "").slice(0, 120).trim(), orgnr = String(x?.orgnr ?? "").replace(/\D/g, "").slice(0, 12);
    if (!name && !orgnr) return json({ error: "Mangler leverandør." }, 400);
    const st: State = (await getDoc<State>(u.org_id!, "config", "ttxinbox")) ?? { seen: {} };
    const same = (y: { name: string; orgnr?: string }) => (orgnr && y.orgnr === orgnr) || (!orgnr && y.name === name);
    st.ignore = (st.ignore ?? []).filter((y) => !same(y));
    if (b.ignore) st.ignore.push({ name, ...(orgnr ? { orgnr } : {}) });
    for (const sv of Object.values(st.seen ?? {})) {
      const hit = (orgnr && String(sv.orgnr ?? "").replace(/\D/g, "") === orgnr) || (!orgnr && sv.name === name);
      if (hit && (sv.s === "ukjent" || sv.s === "ignorert")) sv.s = b.ignore ? "ignorert" : "ukjent";
    }
    await putDoc(u.org_id!, "config", "ttxinbox", st, u.id);
    await audit(u.email, b.ignore ? "importerer ikke fra leverandør" : "importerer igjen fra leverandør", name || orgnr, u.org_id);
    return json({ ok: true, ignore: st.ignore });
  }
  const st = await getDoc<{ lastRun?: string; lastResult?: Record<string, number> }>(u.org_id!, "config", "ttxinbox");
  if (!(b.force && canManage(u)) && st?.lastRun && Date.now() - Date.parse(st.lastRun) < 10 * 60e3) return json({ skipped: true, ...(st.lastResult ?? {}) });
  try {
    return json(await syncTripletexInbox(u.org_id!, { id: u.id, label: u.email }));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Kunne ikke hente fra bilagsmottaket." }, 502);
  }
}
