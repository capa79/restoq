import { db } from "@/lib/db";
import { apiUser, canManage, json } from "@/lib/api-auth";
import { invoiceReaderEnabled } from "@/lib/invoice-reader";
import { tripletexConfigured } from "@/lib/tripletex";
import { plandayConfigured } from "@/lib/planday";

// Alle data for kunden i én forespørsel. Appen henter på nytt jevnlig, så alle ansatte ser samme tall.
export async function GET(req: Request) {
  const u = await apiUser(req);
  if (u instanceof Response) return u;
  const p = await db();
  const { rows } = await p.query("SELECT col, id, data, extract(epoch from updated_at)*1000 AS ts FROM docs WHERE org_id = $1", [u.org_id]);
  const out: Record<string, unknown[]> = { waste: [], orders: [], counts: [], config: [], invoices: [], slips: [] };
  for (const r of rows) (out[r.col] ??= []).push({ ...r.data, id: r.id });
  // Status for koblinger til andre systemer (grønt lys i appen). Ingen hemmeligheter sendes.
  const integ = (await p.query("SELECT provider, info, created_at FROM integrations WHERE org_id = $1", [u.org_id])).rows;
  const one = (prov: string) => integ.find((r) => r.provider === prov);
  const pd = one("planday"), tx = one("tripletex"), pos = one("pos");
  const integrations = {
    planday: { available: plandayConfigured(), connected: !!pd, since: pd?.info?.connectedAt ?? null, lastSync: pd?.info?.lastSync ?? null, error: pd?.info?.lastError ?? null },
    accounting: { available: tripletexConfigured(), connected: !!tx, since: tx?.info?.connectedAt ?? null, system: "Tripletex", lastInbox: tx?.info?.lastInbox ?? null, inboxAuto: tx?.info?.inboxAuto !== false },
    pos: { available: false, connected: !!pos, since: pos?.info?.connectedAt ?? null },
    claude: { available: invoiceReaderEnabled(), connected: invoiceReaderEnabled() },
  };
  return json({ docs: out, integrations, me: { name: u.name, email: u.email, role: u.role, canManage: canManage(u), org: u.org_name }, features: { readInvoice: invoiceReaderEnabled() } });
}
