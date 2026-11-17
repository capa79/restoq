import { apiUser, json } from "@/lib/api-auth";
import { createInvoice } from "@/lib/invoices";

export async function POST(req: Request) {
  const u = await apiUser(req, true);
  if (u instanceof Response) return u;
  const b = await req.json().catch(() => ({}));
  try {
    return json({ invoice: await createInvoice(u.org_id!, b, { id: u.id, label: u.email }, "app") });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Kunne ikke registrere fakturaen." }, 400);
  }
}
