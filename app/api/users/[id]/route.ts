import { audit, db } from "@/lib/db";
import { apiUser, canManage, json } from "@/lib/api-auth";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await apiUser(req, true);
  if (u instanceof Response) return u;
  if (!canManage(u)) return json({ error: "Bare leder kan fjerne brukere." }, 403);
  const id = Number((await ctx.params).id);
  if (id === u.id) return json({ error: "Du kan ikke fjerne deg selv." }, 400);
  const p = await db();
  const t = (await p.query("SELECT email, role FROM users WHERE id = $1 AND org_id = $2 AND role IN ('owner','staff') AND NOT is_root", [id, u.org_id])).rows[0];
  if (!t) return json({ error: "Fant ikke brukeren." }, 404);
  if (t.role === "owner") {
    const n = Number((await p.query("SELECT count(*) FROM users WHERE org_id = $1 AND role = 'owner'", [u.org_id])).rows[0].count);
    if (n <= 1) return json({ error: "Det må alltid være minst én leder." }, 400);
  }
  await p.query("DELETE FROM users WHERE id = $1", [id]);
  await audit(u.email, "fjernet bruker", t.email, u.org_id);
  return json({ ok: true });
}

/** Endre rolle: administrator (owner) eller ansatt (staff). Kunden må alltid ha minst én administrator. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await apiUser(req, true);
  if (u instanceof Response) return u;
  if (!canManage(u)) return json({ error: "Bare administrator kan endre roller." }, 403);
  const id = Number((await ctx.params).id);
  const b = await req.json().catch(() => ({}));
  const role = b.role === "owner" ? "owner" : b.role === "staff" ? "staff" : null;
  if (!role) return json({ error: "Ugyldig rolle." }, 400);
  const p = await db();
  const t = (await p.query("SELECT email, role FROM users WHERE id = $1 AND org_id = $2 AND role IN ('owner','staff') AND NOT is_root", [id, u.org_id])).rows[0];
  if (!t) return json({ error: "Fant ikke brukeren." }, 404);
  if (t.role === "owner" && role === "staff") {
    const n = Number((await p.query("SELECT count(*) FROM users WHERE org_id = $1 AND role = 'owner'", [u.org_id])).rows[0].count);
    if (n <= 1) return json({ error: "Det må alltid være minst én administrator." }, 400);
  }
  await p.query("UPDATE users SET role = $2 WHERE id = $1", [id, role]);
  await p.query("DELETE FROM sessions WHERE user_id = $1 AND user_id <> $2", [id, u.id]); // ny rolle gjelder fra neste innlogging
  await audit(u.email, role === "owner" ? "gjorde til administrator" : "endret til ansatt", t.email, u.org_id);
  return json({ ok: true });
}
