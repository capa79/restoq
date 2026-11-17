import { createSlip } from "@/lib/invoices";
import { attachFromBody, v1auth, v1json } from "@/lib/v1";

/** POST /api/v1/packing-slips – registrer pakkseddel, valgfritt med varemottak (receive: true). */
export async function POST(req: Request) {
  const k = await v1auth(req);
  if (k instanceof Response) return k;
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return v1json({ error: "bad_request", message: "Body må være JSON." }, 400);
  try {
    const fileId = await attachFromBody(k.orgId, b);
    const s = await createSlip(k.orgId, { ...b, fileId: fileId ?? b.fileId }, { id: null, label: k.label }, "api");
    return v1json({ id: s.id, orderId: s.orderId, received: s.received }, 201);
  } catch (e) {
    return v1json({ error: "invalid", message: e instanceof Error ? e.message : "Ugyldig pakkseddel." }, 422);
  }
}
