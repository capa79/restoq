import { randomUUID } from "crypto";
import { audit, db } from "@/lib/db";
import { apiUser, canManage, json } from "@/lib/api-auth";
import { requirePassword } from "@/lib/reauth";

const num = (v: unknown) => { const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : null; };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Manuell endring av bestand for én vare. Bare leder/admin, og bare med passord ("signatur").
 * Lagres i samlingen «adjust» (kan ikke skrives direkte fra appen) og i hendelsesloggen.
 * Den nye bestanden brukes som utgangspunkt for varen fram til neste telling.
 */
export async function POST(req: Request) {
  const u = await apiUser(req, true);
  if (u instanceof Response) return u;
  if (!canManage(u)) return json({ error: "Bare leder kan endre bestand manuelt." }, 403);
  const b = await req.json().catch(() => ({}));
  const itemId = String(b.itemId ?? "").slice(0, 80);
  const name = String(b.name ?? "").slice(0, 160);
  const unit = String(b.unit ?? "").slice(0, 20);
  const qty = num(b.qty), prev = num(b.prev);
  const reason = String(b.reason ?? "").trim().slice(0, 500);
  const date = DATE_RE.test(String(b.date)) ? String(b.date) : new Date().toISOString().slice(0, 10);
  if (!itemId || /[\u0000-\u001f<>]/.test(itemId)) return json({ error: "Ugyldig vare." }, 400);
  if (qty == null || qty < 0 || qty > 1e7) return json({ error: "Skriv inn ny bestand (0 eller mer)." }, 400);
  if (reason.length < 3) return json({ error: "Skriv hvorfor bestanden endres." }, 400);
  if (date > new Date(Date.now() + 864e5).toISOString().slice(0, 10)) return json({ error: "Datoen kan ikke være fram i tid." }, 400);
  const stop = await requirePassword(u, b.password, `bestanden for ${name || itemId} endres manuelt`);
  if (stop) return stop;
  const id = `adj-${randomUUID()}`;
  const doc = { itemId, name, unit, qty, prev, reason, date, ts: Date.now(), at: new Date().toISOString(), by: u.email, byName: u.name ?? "", signed: true };
  const p = await db();
  await p.query("INSERT INTO docs (org_id, col, id, data, updated_by, updated_at) VALUES ($1, 'adjust', $2, $3, $4, now())", [u.org_id, id, JSON.stringify(doc), u.id]);
  await audit(u.email, "endret bestand manuelt (signert med passord)", `${name || itemId}: ${prev ?? "?"} → ${qty} ${unit} · ${reason}`.slice(0, 900), u.org_id);
  return json({ ok: true, adjust: { ...doc, id } });
}
