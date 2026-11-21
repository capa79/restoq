import { audit, db } from "@/lib/db";
import { apiUser, canManage, ID_RE, json } from "@/lib/api-auth";
import { getDoc, putDoc, rematch, type Invoice } from "@/lib/invoices";
import { readFile } from "@/lib/files";
import { addSupplierPayment, approveSupplierInvoice, importDocument, TripletexError } from "@/lib/tripletex";

const iso = () => new Date().toISOString();

export async function POST(req: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  const u = await apiUser(req, true);
  if (u instanceof Response) return u;
  const { id, action } = await ctx.params;
  if (!ID_RE.test(id)) return json({ error: "Ugyldig." }, 400);
  const b = await req.json().catch(() => ({}));
  const orgId = u.org_id!;
  const by = { id: u.id, label: u.email };
  try {
    if (action === "match") return json({ invoice: await rematch(orgId, id, { orderId: b.orderId ?? undefined, lines: b.lines ?? undefined, amountExVat: b.amountExVat ?? undefined } as Partial<Invoice>, by) });
    if (!canManage(u)) return json({ error: "Bare leder kan godkjenne, sende og betale fakturaer." }, 403);
    const inv = await getDoc<Invoice>(orgId, "invoices", id);
    if (!inv) return json({ error: "Fant ikke fakturaen." }, 404);
    const note = String(b.note ?? "").slice(0, 300);
    const log = (action: string, n?: string) => (inv.history = [...(inv.history ?? []), { ts: iso(), by: u.email, action, note: n || undefined }]);
    inv.ttx = inv.ttx ?? {};

    if (action === "approve") {
      if (inv.status === "avvik" && !note) return json({ error: "Fakturaen har avvik. Skriv en kommentar om hvorfor den godkjennes likevel." }, 400);
      if (inv.ttx.supplierInvoiceId) await approveSupplierInvoice(orgId, inv.ttx.supplierInvoiceId, note);
      inv.ttx.approvedAt = iso();
      if (!["sendt", "betalt"].includes(inv.status)) inv.status = "godkjent";
      log(inv.ttx.supplierInvoiceId ? "godkjent (også i regnskap)" : "godkjent", note);
    } else if (action === "send") {
      // Til bilagsmottaket i Tripletex for bokføring. Fakturaer som allerede ligger i Tripletex (EHF) sendes ikke på nytt.
      if (inv.ttx.supplierInvoiceId) return json({ error: "Fakturaen ligger allerede i regnskapet." }, 400);
      if (!inv.ttx.approvedAt) return json({ error: "Godkjenn fakturaen før den sendes til regnskap." }, 400);
      if (!inv.fileId) return json({ error: "Last opp fakturaen (PDF/bilde) før den sendes til regnskap." }, 400);
      const f = await readFile(orgId, inv.fileId);
      if (!f) return json({ error: "Fant ikke fakturafilen." }, 404);
      const ids = await importDocument(orgId, f, `${inv.supplier} faktura ${inv.invoiceNo} – godkjent i Restoq${inv.orderId ? " (bestilling " + inv.orderId + ")" : ""}`);
      inv.ttx.voucherIds = ids;
      inv.status = "sendt";
      log("sendt til regnskap (bilagsmottak)", ids.length ? `bilag ${ids.join(", ")}` : "");
    } else if (action === "pay") {
      if (!inv.ttx.supplierInvoiceId) return json({ error: "Fakturaen må være bokført i regnskapet først. Trykk «Hent fra regnskap» når bilaget er bokført." }, 400);
      if (!inv.ttx.approvedAt) return json({ error: "Godkjenn fakturaen først." }, 400);
      await addSupplierPayment(orgId, inv.ttx.supplierInvoiceId, { amount: inv.amount, paymentDate: inv.dueDate });
      inv.ttx.paymentAt = iso();
      inv.status = "betalt";
      log("sendt til betaling i regnskap", inv.dueDate ? `forfall ${inv.dueDate}` : "");
    } else if (action === "reject") {
      inv.status = "avvist";
      log("avvist", note);
    } else if (action === "reopen") {
      inv.status = inv.match?.ok ? "matchet" : "avvik";
      log("åpnet igjen", note);
    } else if (action === "delete") {
      if (inv.status === "sendt" || inv.status === "betalt") return json({ error: "Fakturaen er sendt til regnskap og kan ikke slettes her." }, 400);
      const p = await db();
      await p.query("DELETE FROM docs WHERE org_id = $1 AND col = 'invoices' AND id = $2", [orgId, id]);
      await audit(u.email, "slettet faktura", `${inv.supplier} ${inv.invoiceNo}`, orgId);
      return json({ ok: true });
    } else return json({ error: "Ukjent handling." }, 400);

    await putDoc(orgId, "invoices", id, inv, u.id);
    await audit(u.email, `faktura: ${action}`, `${inv.supplier} ${inv.invoiceNo}`, orgId);
    return json({ invoice: { ...inv, id } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Noe gikk galt.";
    return json({ error: msg }, e instanceof TripletexError ? 502 : 400);
  }
}
