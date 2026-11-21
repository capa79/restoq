import { db } from "@/lib/db";
import { apiUser, canManage, json } from "@/lib/api-auth";
import { getDoc, loadDocs, matchInvoice, newId, putDoc, type Invoice } from "@/lib/invoices";
import { listSupplierInvoices } from "@/lib/tripletex";

// Henter leverandørfakturaer fra Tripletex (f.eks. EHF som kommer rett dit) og kobler dem til Restoq-fakturaer.
export async function POST(req: Request) {
  const u = await apiUser(req, true);
  if (u instanceof Response) return u;
  if (!canManage(u)) return json({ error: "Bare leder kan hente fra regnskap." }, 403);
  const orgId = u.org_id!;
  const to = new Date();
  const from = new Date(Date.now() - 60 * 864e5);
  try {
    const list = await listSupplierInvoices(orgId, from.toISOString().slice(0, 10), new Date(to.getTime() + 864e5).toISOString().slice(0, 10));
    const d = await loadDocs(orgId);
    const p = await db();
    const existing = (await p.query("SELECT id, data FROM docs WHERE org_id = $1 AND col = 'invoices'", [orgId])).rows as { id: string; data: Invoice }[];
    const norm = (s: string) => s.toLowerCase().replace(/\b(as|asa|ab|engros)\b/g, "").replace(/[^a-zæøå0-9]/g, "");
    const supFor = (s: { name?: string; organizationNumber?: string } | undefined) => {
      if (!s) return null;
      for (const [code, v] of Object.entries(d.suppliers)) {
        if (v.orgnr && s.organizationNumber && v.orgnr.replace(/\D/g, "") === s.organizationNumber.replace(/\D/g, "")) return code;
      }
      const n = norm(s.name ?? "");
      for (const [code, v] of Object.entries(d.suppliers)) if (n && (norm(v.name).includes(n) || n.includes(norm(v.name)))) return code;
      return null;
    };
    let linked = 0, created = 0, unknown = 0;
    for (const t of list) {
      const hit = existing.find((e) => e.data.ttx?.supplierInvoiceId === t.id) ?? existing.find((e) => t.invoiceNumber && e.data.invoiceNo === t.invoiceNumber && (!supFor(t.supplier) || e.data.supplier === supFor(t.supplier)));
      if (hit) {
        if (hit.data.ttx?.supplierInvoiceId !== t.id) {
          const inv = (await getDoc<Invoice>(orgId, "invoices", hit.id))!;
          inv.ttx = { ...(inv.ttx ?? {}), supplierInvoiceId: t.id, voucherIds: t.voucher ? [t.voucher.id] : inv.ttx?.voucherIds };
          inv.history = [...(inv.history ?? []), { ts: new Date().toISOString(), by: "Tripletex", action: "koblet til leverandørfaktura i regnskap", note: `id ${t.id}` }];
          await putDoc(orgId, "invoices", hit.id, inv, u.id);
          linked++;
        }
        continue;
      }
      const sup = supFor(t.supplier);
      if (!sup) { unknown++; continue; }
      const inv: Invoice = {
        supplier: sup, invoiceNo: t.invoiceNumber ?? String(t.id), invoiceDate: t.invoiceDate ?? to.toISOString().slice(0, 10), dueDate: t.invoiceDueDate,
        amount: t.amount, amountExVat: t.amountExcludingVat, currency: "NOK", lines: [], source: "tripletex", status: "kontroll",
        ttx: { supplierInvoiceId: t.id, voucherIds: t.voucher ? [t.voucher.id] : [] },
        history: [{ ts: new Date().toISOString(), by: "Tripletex", action: "hentet fra regnskap" }], createdAt: new Date().toISOString(),
      };
      inv.match = matchInvoice(inv, d);
      if (inv.match.orderId) inv.orderId = inv.match.orderId;
      inv.status = !inv.match.orderId ? "kontroll" : inv.match.ok ? "matchet" : "avvik";
      await putDoc(orgId, "invoices", newId(), inv, u.id);
      created++;
    }
    return json({ fetched: list.length, linked, created, unknown });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Kunne ikke hente fra regnskap." }, 502);
  }
}
