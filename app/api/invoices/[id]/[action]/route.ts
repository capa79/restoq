import { audit, db } from "@/lib/db";
import { apiUser, canManage, ID_RE, json } from "@/lib/api-auth";
import { getDoc, putDoc, rematch, type Invoice } from "@/lib/invoices";
import { readFile } from "@/lib/files";
import { addSupplierPayment, approveSupplierInvoice, importDocument, putVoucherPostings, supplierInvoiceForVoucher, TripletexError } from "@/lib/tripletex";
import { buildPostings, getAccounting } from "@/lib/accounting";
import { requirePassword } from "@/lib/reauth";

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
    // Endringer i regnskapssystemet krever bekreftelse med passord (sjekkes rett før kallet, etter vanlige kontroller)
    const confirm = (what: string) => requirePassword(u, b.password, what);

    if (action === "approve") {
      if (inv.status === "avvik" && !note) return json({ error: "Fakturaen har avvik. Skriv en kommentar om hvorfor den godkjennes likevel." }, 400);
      if (inv.ttx.supplierInvoiceId) {
        const stop = await confirm("fakturaen godkjennes i regnskapet");
        if (stop) return stop;
        await approveSupplierInvoice(orgId, inv.ttx.supplierInvoiceId, note);
      }
      inv.ttx.approvedAt = iso();
      if (!["sendt", "betalt"].includes(inv.status)) inv.status = "godkjent";
      log(inv.ttx.supplierInvoiceId ? "godkjent (også i regnskap)" : "godkjent", note);
    } else if (action === "send") {
      // Til bilagsmottaket i Tripletex for bokføring. Fakturaer som allerede ligger i Tripletex (EHF) sendes ikke på nytt.
      if (inv.ttx.supplierInvoiceId) return json({ error: "Fakturaen ligger allerede i regnskapet." }, 400);
      if (inv.ttx.inbox && inv.ttx.voucherIds?.length) return json({ error: "Fakturaen ligger allerede i bilagsmottaket i regnskapet." }, 400);
      if (!inv.ttx.approvedAt) return json({ error: "Godkjenn fakturaen før den sendes til regnskap." }, 400);
      if (!inv.fileId) return json({ error: "Last opp fakturaen (PDF/bilde) før den sendes til regnskap." }, 400);
      const f = await readFile(orgId, inv.fileId);
      if (!f) return json({ error: "Fant ikke fakturafilen." }, 404);
      const stop = await confirm("fakturaen sendes til regnskap");
      if (stop) return stop;
      const ids = await importDocument(orgId, f, `${inv.supplier} faktura ${inv.invoiceNo} – godkjent i Restoq${inv.orderId ? " (bestilling " + inv.orderId + ")" : ""}`);
      inv.ttx.voucherIds = ids;
      inv.status = "sendt";
      log("sendt til regnskap (bilagsmottak)", ids.length ? `bilag ${ids.join(", ")}` : "");
    } else if (action === "pay") {
      if (!inv.ttx.supplierInvoiceId) return json({ error: "Fakturaen må være bokført i regnskapet først. Trykk «Hent fra regnskap» når bilaget er bokført." }, 400);
      if (!inv.ttx.approvedAt) return json({ error: "Godkjenn fakturaen først." }, 400);
      const stopPay = await confirm("fakturaen sendes til betaling i regnskapet");
      if (stopPay) return stopPay;
      await addSupplierPayment(orgId, inv.ttx.supplierInvoiceId, { amount: inv.amount, paymentDate: inv.dueDate });
      inv.ttx.paymentAt = iso();
      inv.status = "betalt";
      log("sendt til betaling i regnskap", inv.dueDate ? `forfall ${inv.dueDate}` : "");
    } else if (action === "post") {
      // Kontér fakturaen og send bilaget tilbake til regnskapet:
      //  inbox  – kontoforslaget legges på bilaget i bilagsmottaket (regnskapsfører bokfører)
      //  ledger – bilaget bokføres
      //  pay    – bilaget bokføres og legges til betaling (krever at kunden har betaling i regnskapet)
      const mode = b.mode === "ledger" || b.mode === "pay" ? b.mode : "inbox";
      if (inv.ttx.supplierInvoiceId || inv.ttx.posting?.mode === "ledger" || inv.ttx.posting?.mode === "pay") return json({ error: "Fakturaen er allerede bokført i regnskapet." }, 400);
      if (inv.status === "avvist") return json({ error: "Fakturaen er avvist." }, 400);
      if (inv.status !== "matchet" && !inv.ttx.approvedAt) return json({ error: inv.status === "avvik" ? "Fakturaen har avvik. Godkjenn den med en kommentar før den konteres." : "Fakturaen er ikke kontrollert mot bestilling og pakkseddel. Godkjenn den først." }, 400);
      const p = await db();
      const st = (await p.query("SELECT data FROM docs WHERE org_id = $1 AND col = 'config' AND id = 'settings'", [orgId])).rows[0]?.data ?? {};
      if (mode === "pay" && !st.accounting?.payEnabled) return json({ error: "Betaling fra regnskapet er ikke slått på for dette stedet (Innstillinger → Regnskap)." }, 400);
      const cache = await getAccounting(orgId);
      if (!cache?.accounts?.length) return json({ error: "Hent kontoplanen fra regnskapet først (Innstillinger → Regnskap)." }, 400);
      const built = buildPostings(cache, inv, b.postings);
      let voucherId = inv.ttx.voucherIds?.[0];
      if (!voucherId && !inv.fileId) return json({ error: "Last opp fakturaen (PDF/bilde/EHF) før den konteres." }, 400);
      const what = { inbox: "kontoforslaget sendes til bilagsmottaket i regnskapet", ledger: "fakturaen bokføres i regnskapet", pay: "fakturaen bokføres og sendes til betaling i regnskapet" }[mode as "inbox" | "ledger" | "pay"];
      const stop = await confirm(what);
      if (stop) return stop;
      if (!voucherId) {
        const f = await readFile(orgId, inv.fileId!);
        if (!f) return json({ error: "Fant ikke fakturafilen." }, 404);
        const ids = await importDocument(orgId, f, `${inv.supplier} faktura ${inv.invoiceNo} – kontert i Restoq`);
        inv.ttx.voucherIds = ids;
        voucherId = ids[0];
        log("sendt til bilagsmottaket i regnskap", ids.length ? `bilag ${ids.join(", ")}` : "");
        await putDoc(orgId, "invoices", id, inv, u.id); // bilaget finnes nå i regnskapet, selv om konteringen under feiler
        if (!voucherId) throw new Error("Regnskapet opprettet ikke noe bilag for fakturaen.");
      }
      const res = await putVoucherPostings(orgId, voucherId, built.lines.map((l) => ({ accountId: l.accountId, vatTypeId: l.vatTypeId, gross: l.gross, description: l.description || `${inv.supplier} ${inv.invoiceNo}` })), mode !== "inbox");
      if (!inv.ttx.approvedAt) { inv.ttx.approvedAt = iso(); log("godkjent (stemmer med bestilling og varemottak)"); }
      inv.ttx.posting = { at: iso(), by: u.email, mode, total: built.total, lines: built.lines.map(({ account, accountName, vatType, vatPct, net, gross, description }) => ({ account, accountName, vatType, vatPct, net, gross, description })) };
      const summary = built.lines.map((l) => `${l.account} ${l.gross.toFixed(2)}`).join(", ") + (built.rounding ? ` (avrunding ${built.rounding.toFixed(2)})` : "");
      if (mode === "inbox") {
        inv.status = "sendt";
        log("kontert – sendt til bilagsmottaket med kontoforslag", summary);
      } else {
        const sid = res?.id ?? (await supplierInvoiceForVoucher(orgId, voucherId, inv.invoiceDate).catch(() => null));
        if (sid) inv.ttx.supplierInvoiceId = sid;
        inv.status = "sendt";
        log("kontert og bokført i regnskap", summary);
        if (mode === "pay") {
          if (!sid) throw new Error("Bilaget er bokført, men Restoq fant ikke leverandørfakturaen i regnskapet. Send den til betaling fra regnskapet.");
          try {
            await addSupplierPayment(orgId, sid, { amount: inv.amount, paymentDate: inv.dueDate });
          } catch (e) {
            await putDoc(orgId, "invoices", id, inv, u.id);
            const m = e instanceof Error ? e.message : String(e);
            return json({ error: `Fakturaen er bokført, men kunne ikke legges til betaling: ${m}`, invoice: { ...inv, id } }, 502);
          }
          inv.ttx.paymentAt = iso();
          inv.status = "betalt";
          log("sendt til betaling i regnskap", inv.dueDate ? `forfall ${inv.dueDate}` : "");
        }
      }
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
