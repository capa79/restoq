import { audit, db } from "@/lib/db";
import { apiUser, canManage, json } from "@/lib/api-auth";
import { createApiKey } from "@/lib/apikeys";

export async function GET(req: Request) {
  const u = await apiUser(req);
  if (u instanceof Response) return u;
  if (!canManage(u)) return json({ error: "Bare leder." }, 403);
  const p = await db();
  const { rows } = await p.query("SELECT id, name, prefix, created_at, last_used_at FROM api_keys WHERE org_id = $1 ORDER BY created_at DESC", [u.org_id]);
  return json({ keys: rows.map((r) => ({ ...r, id: Number(r.id) })) });
}
export async function POST(req: Request) {
  const u = await apiUser(req, true);
  if (u instanceof Response) return u;
  if (!canManage(u)) return json({ error: "Bare leder." }, 403);
  const b = await req.json().catch(() => ({}));
  const key = await createApiKey(u.org_id!, String(b.name ?? ""), u.id);
  await audit(u.email, "laget API-nøkkel", String(b.name ?? ""), u.org_id);
  return json({ key });
}
