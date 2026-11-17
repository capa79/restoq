import { audit, db } from "@/lib/db";
import { apiUser, canManage, CLIENT_WRITABLE, ID_RE, isCol, json } from "@/lib/api-auth";

const MAX_BYTES = 400_000;

async function check(req: Request, col: string, id: string) {
  const u = await apiUser(req, true);
  if (u instanceof Response) return u;
  if (!isCol(col) || !CLIENT_WRITABLE.includes(col) || !ID_RE.test(id)) return json({ error: "Ugyldig adresse." }, 400);
  // Oppsett (leverandører, varer, logo og farger) kan bare endres av leder
  if (col === "config" && !canManage(u)) return json({ error: "Bare leder kan endre oppsettet." }, 403);
  return u;
}

export async function PUT(req: Request, ctx: { params: Promise<{ col: string; id: string }> }) {
  const { col, id } = await ctx.params;
  const u = await check(req, col, id);
  if (u instanceof Response) return u;
  const text = await req.text();
  if (text.length > MAX_BYTES) return json({ error: "For mye data i én lagring." }, 413);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return json({ error: "Ugyldige data." }, 400);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return json({ error: "Ugyldige data." }, 400);
  delete (data as Record<string, unknown>).id;
  const p = await db();
  await p.query(
    `INSERT INTO docs (org_id, col, id, data, updated_by, updated_at) VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (org_id, col, id) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [u.org_id, col, id, JSON.stringify(data), u.id]
  );
  if (col === "config") await audit(u.email, `endret oppsett (${id})`, "", u.org_id);
  return json({ ok: true });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ col: string; id: string }> }) {
  const { col, id } = await ctx.params;
  const u = await check(req, col, id);
  if (u instanceof Response) return u;
  const p = await db();
  await p.query("DELETE FROM docs WHERE org_id = $1 AND col = $2 AND id = $3", [u.org_id, col, id]);
  await audit(u.email, `slettet ${col}/${id}`, "", u.org_id);
  return json({ ok: true });
}
