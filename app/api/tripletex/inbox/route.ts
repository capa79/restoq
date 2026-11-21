import { apiUser, canManage, json } from "@/lib/api-auth";
import { getDoc } from "@/lib/invoices";
import { syncTripletexInbox } from "@/lib/ttx-inbox";

/** Henter fakturaer fra bilagsmottaket i Tripletex. Alle innloggede kan starte henting, men høyst hvert 10. minutt (administrator kan tvinge). */
export async function POST(req: Request) {
  const u = await apiUser(req, true);
  if (u instanceof Response) return u;
  const b = await req.json().catch(() => ({}));
  const st = await getDoc<{ lastRun?: string; lastResult?: Record<string, number> }>(u.org_id!, "config", "ttxinbox");
  if (!(b.force && canManage(u)) && st?.lastRun && Date.now() - Date.parse(st.lastRun) < 10 * 60e3) return json({ skipped: true, ...(st.lastResult ?? {}) });
  try {
    return json(await syncTripletexInbox(u.org_id!, { id: u.id, label: u.email }));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Kunne ikke hente fra bilagsmottaket." }, 502);
  }
}
