import { audit, db } from "@/lib/db";
import { apiUser, canManage, json } from "@/lib/api-auth";
import { passwordProblem } from "@/lib/password";
import { setUserPassword } from "@/lib/users";

/** Kundens administrator setter passord for en bruker i egen bedrift. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await apiUser(req, true);
  if (u instanceof Response) return u;
  if (!canManage(u)) return json({ error: "Bare administrator kan sette passord for andre." }, 403);
  const id = Number((await ctx.params).id);
  if (id === u.id) return json({ error: "Bytt ditt eget passord under «Bytt passord»." }, 400);
  const b = await req.json().catch(() => ({}));
  const pw = String(b.password ?? "");
  const problem = passwordProblem(pw);
  if (problem) return json({ error: problem }, 400);
  const p = await db();
  const t = (await p.query("SELECT email FROM users WHERE id = $1 AND org_id = $2 AND role IN ('owner','staff') AND NOT is_root", [id, u.org_id])).rows[0];
  if (!t) return json({ error: "Fant ikke brukeren." }, 404);
  const mustChange = b.mustChange !== false;
  await setUserPassword(id, pw, mustChange);
  await audit(u.email, mustChange ? "satte midlertidig passord" : "satte passord", t.email, u.org_id);
  return json({ ok: true, mustChange });
}
