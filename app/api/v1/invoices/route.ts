import { db } from "@/lib/db";
import { createInvoice } from "@/lib/invoices";
import { attachFromBody, v1auth, v1json } from "@/lib/v1";

/** POST /api/v1/invoices – registrer leverandørfaktura (se /api-dokumentasjon). */
export async function POST(req: Request) {
  const k = await v1auth(req);
  if (k instanceof Response) return k;
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return v1json({ error: "bad_request", message: "Body må være JSON." }, 400);
  try {
    const fileId = await attachFromBody(k.orgId, b);
    const inv = await createInvoice(k.orgId, { ...b, fileId: fileId ?? b.fileId }, { id: null, label: k.label }, "api");
    return v1json({ id: inv.id, status: inv.status, orderId: inv.orderId, match: inv.match }, 201);
  } catch (e) {
    return v1json({ error: "invalid", message: e instanceof Error ? e.message : "Ugyldig faktura." }, 422);
  }
}

/** GET /api/v1/invoices?status=avvik – liste */
export async function GET(req: Request) {
  const k = await v1auth(req);
  if (k instanceof Response) return k;
  const status = new URL(req.url).searchParams.get("status");
  const p = await db();
  const { rows } = await p.query(
    "SELECT id, data FROM docs WHERE org_id = $1 AND col = 'invoices' AND ($2::text IS NULL OR data->>'status' = $2) ORDER BY updated_at DESC LIMIT 200",
    [k.orgId, status]
  );
  return v1json({ invoices: rows.map((r) => ({ id: r.id, supplier: r.data.supplier, invoiceNo: r.data.invoiceNo, invoiceDate: r.data.invoiceDate, amount: r.data.amount, status: r.data.status, orderId: r.data.orderId ?? null, ok: r.data.match?.ok ?? null })) });
}
