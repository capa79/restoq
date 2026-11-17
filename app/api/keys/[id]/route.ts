import { audit, db } from "@/lib/db";
import { apiUser, canManage, json } from "@/lib/api-auth";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await apiUser(req, true);
  if (u instanceof Response) return u;
  if (!canManage(u)) return json({ error: "Bare leder." }, 403);
  const p = await db();
  await p.query("DELETE FROM api_keys WHERE id = $1 AND org_id = $2", [Number((await ctx.params).id), u.org_id]);
  await audit(u.email, "slettet API-nøkkel", "", u.org_id);
  return json({ ok: true });
}
