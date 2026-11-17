import { db } from "@/lib/db";
import { v1auth, v1json } from "@/lib/v1";

/** GET /api/v1/orders?status=bestilt – bestillinger med linjer (varenr, antall). */
export async function GET(req: Request) {
  const k = await v1auth(req);
  if (k instanceof Response) return k;
  const status = new URL(req.url).searchParams.get("status");
  const p = await db();
  const { rows } = await p.query(
    "SELECT id, data FROM docs WHERE org_id = $1 AND col = 'orders' AND ($2::text IS NULL OR data->>'status' = $2) ORDER BY data->>'deliveryDate' DESC LIMIT 200",
    [k.orgId, status]
  );
  return v1json({ orders: rows.map((r) => ({ id: r.id, supplier: r.data.sup, status: r.data.status, orderDate: r.data.orderDate, deliveryDate: r.data.deliveryDate, lines: (r.data.lines ?? []).map((l: { id: string; qty: number; recv?: number; price?: number }) => ({ itemNo: l.id.split("-").slice(1).join("-"), itemId: l.id, qty: l.qty, received: l.recv ?? null, price: l.price ?? null })) })) });
}
