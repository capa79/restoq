import { db } from "@/lib/db";
import { apiUser, canManage, json } from "@/lib/api-auth";
import { invoiceReaderEnabled } from "@/lib/invoice-reader";

// Alle data for kunden i én forespørsel. Appen henter på nytt jevnlig, så alle ansatte ser samme tall.
export async function GET(req: Request) {
  const u = await apiUser(req);
  if (u instanceof Response) return u;
  const p = await db();
  const { rows } = await p.query("SELECT col, id, data, extract(epoch from updated_at)*1000 AS ts FROM docs WHERE org_id = $1", [u.org_id]);
  const out: Record<string, unknown[]> = { waste: [], orders: [], counts: [], config: [], invoices: [], slips: [] };
  for (const r of rows) (out[r.col] ??= []).push({ ...r.data, id: r.id });
  return json({ docs: out, me: { name: u.name, email: u.email, role: u.role, canManage: canManage(u), org: u.org_name }, features: { readInvoice: invoiceReaderEnabled() } });
}
