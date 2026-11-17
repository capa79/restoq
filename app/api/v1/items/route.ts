import { db } from "@/lib/db";
import { v1auth, v1json } from "@/lib/v1";

/** GET /api/v1/items – varekatalog (leverandør, varenr, navn, enhet, avtalt pris). */
export async function GET(req: Request) {
  const k = await v1auth(req);
  if (k instanceof Response) return k;
  const p = await db();
  const r = (await p.query("SELECT data FROM docs WHERE org_id = $1 AND col = 'config' AND id = 'items'", [k.orgId])).rows[0];
  const items = Object.values((r?.data?.ov ?? {}) as Record<string, { id: string; sup: string; no: string; name: string; unit: string; price: number; removed?: boolean }>).filter((i) => !i.removed);
  return v1json({ items: items.map((i) => ({ itemId: i.id, supplier: i.sup, itemNo: i.no, name: i.name, unit: i.unit, price: i.price })) });
}
