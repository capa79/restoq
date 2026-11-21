// Henter leverandørfakturaer fra bilagsmottaket i Tripletex og oppretter dem i Restoq for kontroll.
// Bare fakturaer fra leverandører som er registrert i Restoq tas inn. Hvert bilag leses én gang
// (Claude leser PDF/bilde/EHF når leverandøren ikke står på bilaget), og status lagres i config/ttxinbox.
import { audit, db } from "./db";
import { saveFile } from "./files";
import { invoiceReaderEnabled, readInvoice, type ReadInvoice } from "./invoice-reader";
import { getDoc, loadDocs, matchInvoice, newId, putDoc, type Invoice } from "./invoices";
import { listVoucherReception, ttxBinary, type TtxVoucher } from "./tripletex";

type Seen = { s: "importert" | "koblet" | "ukjent" | "ignorert" | "uten-vedlegg" | "feil"; at: string; inv?: string; sup?: string; name?: string; orgnr?: string; msg?: string };
/** ignore: leverandører som ikke er registrert i Restoq, og som kunden har valgt å ikke importere fra. */
export type State = { seen: Record<string, Seen>; ignore?: { name: string; orgnr?: string }[]; lastRun?: string; lastResult?: Record<string, number> };
export const isIgnored = (st: Pick<State, "ignore">, info: { name?: string; orgnr?: string }) => (st.ignore ?? []).some((x) => (!!x.orgnr && digits(x.orgnr) === digits(info.orgnr)) || (!!norm(x.name) && norm(x.name) === norm(info.name ?? "")));

const MAX_READS_PER_RUN = 10;
const DAILY_LIMIT = 150;
const norm = (s: string) => String(s || "").toLowerCase().replace(/\b(as|asa|ab|engros|norge|norway)\b/g, "").replace(/[^a-zæøå0-9]/g, "");
const digits = (s?: string) => String(s ?? "").replace(/\D/g, "");

type Sup = { name: string; orgnr?: string; bank?: string };
function supplierFor(sups: Record<string, Sup>, info: { name?: string; orgnr?: string; bank?: string }): string | null {
  const o = digits(info.orgnr), b = digits(info.bank);
  for (const [code, v] of Object.entries(sups)) if (o && digits(v.orgnr) === o) return code;
  for (const [code, v] of Object.entries(sups)) if (b && digits(v.bank) === b) return code;
  const n = norm(info.name ?? "");
  if (n.length >= 3) for (const [code, v] of Object.entries(sups)) { const m = norm(v.name); if (m && (m === n || (m.length > 3 && (m.includes(n) || n.includes(m))))) return code; }
  return null;
}

export async function syncTripletexInbox(orgId: number, by: { id: number | null; label: string }, opts: { days?: number } = {}) {
  const p = await db();
  const state: State = (await getDoc<State>(orgId, "config", "ttxinbox")) ?? { seen: {} };
  state.seen = state.seen ?? {};
  const today = new Date();
  const from = new Date(Date.now() - (opts.days ?? 60) * 864e5).toISOString().slice(0, 10);
  const to = new Date(today.getTime() + 2 * 864e5).toISOString().slice(0, 10);
  const vouchers = await listVoucherReception(orgId, from, to);
  const d = await loadDocs(orgId);
  const sups = d.suppliers as unknown as Record<string, Sup>;
  const existing = (await p.query("SELECT id, data FROM docs WHERE org_id = $1 AND col = 'invoices'", [orgId])).rows as { id: string; data: Invoice }[];
  const res = { checked: vouchers.length, imported: 0, linked: 0, unknown: 0, ignored: 0, noFile: 0, errors: 0, remaining: 0 };
  let reads = 0;
  const usedToday = Number((await p.query("SELECT count(*)::int AS n FROM audit WHERE org_id = $1 AND action = 'leste faktura med Claude' AND created_at > now() - interval '24 hours'", [orgId])).rows[0].n);

  for (const v of vouchers) {
    const key = String(v.id);
    const prev = state.seen[key];
    // ferdig behandlet (feil prøves igjen etter et døgn)
    if (prev && (prev.s !== "feil" || Date.now() - Date.parse(prev.at) < 864e5)) continue;
    const at = new Date().toISOString();
    // Allerede i Restoq (sendt dit fra Restoq, eller koblet før)?
    const already = existing.find((e) => e.data.ttx?.voucherIds?.includes(v.id));
    if (already) { state.seen[key] = { s: "koblet", at, inv: already.id, sup: already.data.supplier }; continue; }
    // Leverandør på bilaget? Ukjent leverandør hoppes over uten å lese dokumentet.
    const ps = (v.postings ?? []).map((x) => x.supplier).find((x) => x && (x.name || x.organizationNumber));
    if (ps && !supplierFor(sups, { name: ps.name, orgnr: ps.organizationNumber })) {
      const ign = isIgnored(state, { name: ps.name, orgnr: ps.organizationNumber });
      state.seen[key] = { s: ign ? "ignorert" : "ukjent", at, name: ps.name, orgnr: ps.organizationNumber };
      if (ign) res.ignored++; else res.unknown++;
      continue;
    }
    const doc = v.ediDocument?.id ? v.ediDocument : v.attachment?.id ? v.attachment : null;
    if (!doc) { state.seen[key] = { s: "uten-vedlegg", at }; res.noFile++; continue; }
    if (!invoiceReaderEnabled() || reads >= MAX_READS_PER_RUN || usedToday + reads >= DAILY_LIMIT) { res.remaining++; continue; }
    try {
      const file = await ttxBinary(orgId, `/document/${doc.id}/content`);
      const name = doc.fileName || `bilag-${v.id}${file.mime.includes("xml") ? ".xml" : file.mime.includes("pdf") ? ".pdf" : ""}`;
      reads++;
      const r: ReadInvoice = await readInvoice({ mime: file.mime.includes("xml") || /\.xml$/i.test(name) ? "application/xml" : file.mime, data: file.data, name });
      await audit(by.label, "leste faktura med Claude", `bilagsmottak ${v.id} · ${r.lines.length} linjer`, orgId);
      const sup = (ps && supplierFor(sups, { name: ps.name, orgnr: ps.organizationNumber })) || supplierFor(sups, { name: r.supplierName, orgnr: r.supplierOrgNo, bank: r.supplierBankAccount });
      if (!sup) { const ign = isIgnored(state, { name: r.supplierName, orgnr: r.supplierOrgNo }); state.seen[key] = { s: ign ? "ignorert" : "ukjent", at, name: r.supplierName, orgnr: r.supplierOrgNo }; if (ign) res.ignored++; else res.unknown++; continue; }
      const invNo = r.invoiceNo || v.vendorInvoiceNumber || `bilag ${v.id}`;
      const dup = existing.find((e) => e.data.supplier === sup && e.data.invoiceNo === invNo);
      if (dup) {
        const inv = (await getDoc<Invoice>(orgId, "invoices", dup.id))!;
        inv.ttx = { ...(inv.ttx ?? {}), voucherIds: [...new Set([...(inv.ttx?.voucherIds ?? []), v.id])], inbox: true };
        inv.history = [...(inv.history ?? []), { ts: at, by: "Tripletex", action: "koblet til bilag i bilagsmottaket", note: `bilag ${v.id}` }];
        await putDoc(orgId, "invoices", dup.id, inv, by.id);
        state.seen[key] = { s: "koblet", at, inv: dup.id, sup };
        res.linked++;
        continue;
      }
      let fileId: string | null = null;
      try { fileId = (await saveFile(orgId, name, file.mime, file.data, by.id)).id; } catch { fileId = null; }
      const inv: Invoice = {
        supplier: sup, invoiceNo: invNo, invoiceDate: r.invoiceDate || v.date || today.toISOString().slice(0, 10), dueDate: r.dueDate || undefined,
        amount: r.amount ?? undefined, amountExVat: r.amountExVat ?? undefined, vat: r.vat ?? undefined, currency: r.currency || "NOK", kid: r.kid || undefined, fileId,
        lines: r.lines.map((l) => ({ itemNo: l.itemNo || "", description: l.description, qty: l.qty ?? 0, unitPrice: l.unitPrice ?? undefined, total: l.lineTotal ?? undefined, vat: l.vatRate ?? undefined })),
        source: "tripletex", status: "kontroll", ttx: { voucherIds: [v.id], inbox: true },
        history: [{ ts: at, by: "Tripletex", action: "hentet fra bilagsmottaket", note: `bilag ${v.id}${r.warnings.length ? " · " + r.warnings.join("; ") : ""}` }], createdAt: at,
      };
      inv.match = matchInvoice(inv, d);
      if (inv.match.orderId) inv.orderId = inv.match.orderId;
      inv.status = !inv.match.orderId ? "kontroll" : inv.match.ok ? "matchet" : "avvik";
      const id = newId();
      await putDoc(orgId, "invoices", id, inv, by.id);
      existing.push({ id, data: inv });
      state.seen[key] = { s: "importert", at, inv: id, sup };
      res.imported++;
    } catch (e) {
      state.seen[key] = { s: "feil", at, msg: e instanceof Error ? e.message.slice(0, 200) : String(e) };
      res.errors++;
    }
  }
  // hold listen kort: glem bilag eldre enn 120 dager
  const cutoff = Date.now() - 120 * 864e5;
  for (const [k, sv] of Object.entries(state.seen)) if (Date.parse(sv.at) < cutoff) delete state.seen[k];
  state.lastRun = new Date().toISOString();
  state.lastResult = res;
  await putDoc(orgId, "config", "ttxinbox", state, by.id);
  await p.query("UPDATE integrations SET info = info || $2 WHERE org_id = $1 AND provider = 'tripletex'", [orgId, JSON.stringify({ lastInbox: state.lastRun })]);
  return res;
}
