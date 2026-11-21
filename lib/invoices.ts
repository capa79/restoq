// Fakturaer og pakksedler: registrering og trevei-matching mot bestilling og varemottak.
import { randomBytes } from "node:crypto";
import { audit, db } from "./db";

export type Line = { itemNo: string; itemId?: string; description?: string; qty: number; unitPrice?: number; total?: number };
export type Invoice = {
  id?: string;
  supplier: string;
  invoiceNo: string;
  invoiceDate: string;
  dueDate?: string;
  amountExVat?: number;
  vat?: number;
  amount?: number;
  currency?: string;
  orderId?: string | null;
  slipId?: string | null;
  fileId?: string | null;
  kid?: string;
  lines: Line[];
  source: "app" | "api" | "tripletex";
  status: "kontroll" | "avvik" | "matchet" | "godkjent" | "sendt" | "betalt" | "avvist";
  ttx?: { supplierInvoiceId?: number; voucherIds?: number[]; approvedAt?: string; paymentAt?: string; inbox?: boolean };
  match?: Match;
  history: { ts: string; by: string; action: string; note?: string }[];
  createdAt: string;
};
export type Slip = { id?: string; supplier: string; slipNo: string; date: string; orderId?: string | null; fileId?: string | null; lines: Line[]; received?: boolean; createdAt: string; source: "app" | "api" };
export type MatchLine = { itemId: string | null; itemNo: string; name: string; ordered: number | null; received: number | null; invoiced: number | null; agreedPrice: number | null; invoicedPrice: number | null; flags: string[]; charge?: boolean; amount?: number | null };
export type Match = { orderId: string | null; ok: boolean; lines: MatchLine[]; issues: string[]; expectedExVat: number | null; invoicedExVat: number | null; checkedAt: string };

export const newId = () => Date.now().toString(36) + randomBytes(4).toString("hex");
const iso = () => new Date().toISOString();
const PRICE_TOL = 0.02; // 2 % prisavvik godtas
const AMOUNT_TOL = (v: number) => Math.max(10, Math.abs(v) * 0.01); // 1 % / minst 10 kr

type Docs = { orders: Record<string, unknown>[]; slips: Slip[]; items: Record<string, { id: string; sup: string; no: string; name: string; price?: number }>; suppliers: Record<string, { name: string; orgnr?: string; charges?: { key?: string; kind: string; name: string; last?: number | null }[] }> };

export async function loadDocs(orgId: number): Promise<Docs> {
  const p = await db();
  const { rows } = await p.query("SELECT col, id, data FROM docs WHERE org_id = $1 AND col IN ('orders','slips','config')", [orgId]);
  const out: Docs = { orders: [], slips: [], items: {}, suppliers: {} };
  for (const r of rows) {
    if (r.col === "orders") out.orders.push({ ...r.data, id: r.id });
    else if (r.col === "slips") out.slips.push({ ...r.data, id: r.id });
    else if (r.col === "config" && r.id === "items") for (const [k, v] of Object.entries((r.data.ov ?? {}) as Record<string, never>)) out.items[k] = v;
    else if (r.col === "config" && r.id === "settings") out.suppliers = r.data.suppliers ?? {};
  }
  return out;
}

export const itemIdFor = (sup: string, itemNo: string) => `${sup}-${String(itemNo).replace(/[^A-Za-z0-9]/g, "")}`;

type OrderLine = { id: string; qty: number; recv?: number; price?: number };
type Order = { id: string; sup: string; status: string; orderDate: string; deliveryDate: string; lines: OrderLine[] };

/** Finn bestillingen: oppgitt referanse, ellers beste treff hos samme leverandør rundt fakturadatoen. */
function findOrder(d: Docs, sup: string, ref: string | null | undefined, date: string, itemIds: string[]): Order | null {
  const orders = d.orders as unknown as Order[];
  if (ref) {
    const hit = orders.find((o) => o.id === ref || o.id.endsWith(ref));
    if (hit) return hit;
  }
  const t = Date.parse(date || iso());
  const cands = orders
    .filter((o) => o.sup === sup && o.status !== "kansellert" && Math.abs(Date.parse(o.deliveryDate) - t) <= 21 * 864e5)
    .map((o) => ({ o, overlap: o.lines.filter((l) => itemIds.includes(l.id)).length, dist: Math.abs(Date.parse(o.deliveryDate) - t) }))
    .filter((c) => c.overlap > 0 || itemIds.length === 0)
    .sort((a, b) => b.overlap - a.overlap || a.dist - b.dist);
  return cands[0]?.o ?? null;
}

// Frakt, gebyrer, pant og avgifter: egne linjer på leverandøren, ikke varer (samme regel som i appen)
export const FEE_RE = /frakt|gebyr|pant|levering|transport|rabatt|miljøavgift|emballasjeavgift|småordre|drivstoff|porto|ekspedisjon/i;
const normTxt = (s: string) => String(s || "").toUpperCase().replace(/[0-9.,%]+/g, " ").replace(/[^A-ZÆØÅ ]+/g, " ").replace(/\s+/g, " ").trim();

export function matchInvoice(inv: Invoice, d: Docs): Match {
  const isCharge = (l: Line) => FEE_RE.test(l.description || "") && !(l.itemId || d.items[itemIdFor(inv.supplier, l.itemNo)]);
  const chargeLines = inv.lines.filter(isCharge);
  const lines = inv.lines.filter((l) => !isCharge(l)).map((l) => ({ ...l, itemId: l.itemId || itemIdFor(inv.supplier, l.itemNo) }));
  const order = findOrder(d, inv.supplier, inv.orderId, inv.invoiceDate, lines.map((l) => l.itemId!));
  const slip = inv.slipId ? d.slips.find((s) => s.id === inv.slipId) : order ? d.slips.find((s) => s.orderId === order.id) : undefined;
  const issues: string[] = [];
  const out: MatchLine[] = [];
  const ids = new Set<string>([...lines.map((l) => l.itemId!), ...(order?.lines.map((l) => l.id) ?? [])]);
  let expected = 0;
  for (const id of ids) {
    const il = lines.filter((l) => l.itemId === id);
    const ol = order?.lines.find((l) => l.id === id);
    const sl = slip?.lines.filter((l) => (l.itemId || itemIdFor(inv.supplier, l.itemNo)) === id);
    const item = d.items[id];
    const invoiced = il.length ? il.reduce((s, l) => s + (Number(l.qty) || 0), 0) : null;
    const ordered = ol ? ol.qty : null;
    const received = order && order.status === "mottatt" && ol ? (ol.recv ?? ol.qty) : sl && sl.length ? sl.reduce((s, l) => s + (Number(l.qty) || 0), 0) : null;
    const invPrice = il.length && il[0].unitPrice != null ? Number(il[0].unitPrice) : null;
    const agreed = ol?.price ?? item?.price ?? null;
    const flags: string[] = [];
    if (invoiced != null && ordered == null && order) flags.push("Ikke bestilt");
    if (invoiced != null && received != null && invoiced - received > 1e-6) flags.push(`Fakturert ${invoiced}, mottatt ${received}`);
    if (invoiced == null && received != null && received > 0) flags.push("Mottatt, men ikke fakturert");
    if (invoiced != null && received == null && ordered != null) flags.push("Ikke registrert mottatt");
    if (invPrice != null && agreed != null && agreed > 0 && Math.abs(invPrice - agreed) / agreed > PRICE_TOL) flags.push(`Pris ${invPrice.toFixed(2)} mot avtalt ${agreed.toFixed(2)}`);
    if (!item && invoiced != null) flags.push("Ukjent vare");
    expected += (received ?? 0) * (agreed ?? invPrice ?? 0);
    out.push({ itemId: item ? id : null, itemNo: il[0]?.itemNo ?? item?.no ?? id.split("-").slice(1).join("-"), name: item?.name ?? il[0]?.description ?? id, ordered, received, invoiced, agreedPrice: agreed, invoicedPrice: invPrice, flags });
  }
  // Gebyrer og frakt: regnes med i forventet beløp, sammenlignes med det som er registrert på leverandøren
  const known = d.suppliers[inv.supplier]?.charges ?? [];
  for (const l of chargeLines) {
    const amount = l.total ?? (l.unitPrice != null ? (Number(l.qty) || 1) * Number(l.unitPrice) : null);
    const k = known.find((c) => normTxt(c.name) === normTxt(l.description ?? ""));
    const flags: string[] = [];
    if (!k) flags.push("Nytt gebyr – ikke registrert på leverandøren");
    else if (k.last != null && amount != null && Math.abs(amount - k.last) > Math.max(1, Math.abs(k.last) * PRICE_TOL)) flags.push(`${amount.toFixed(2)} kr mot vanlig ${Number(k.last).toFixed(2)} kr`);
    if (amount != null) expected += amount;
    out.push({ itemId: null, itemNo: l.itemNo || "", name: l.description || "Gebyr", ordered: null, received: null, invoiced: Number(l.qty) || 1, agreedPrice: k?.last ?? null, invoicedPrice: amount, flags, charge: true, amount });
  }
  if (!order) issues.push("Fant ingen bestilling å matche mot. Velg bestilling manuelt.");
  if (!lines.length) issues.push("Fakturaen har ingen varelinjer – bare beløpet kan kontrolleres.");
  const invoicedExVat = inv.amountExVat ?? (lines.length ? lines.reduce((s, l) => s + (l.total ?? (Number(l.qty) || 0) * (Number(l.unitPrice) || 0)), 0) : null);
  const expectedExVat = order ? Math.round(expected * 100) / 100 : null;
  if (invoicedExVat != null && expectedExVat != null && Math.abs(invoicedExVat - expectedExVat) > AMOUNT_TOL(expectedExVat))
    issues.push(`Fakturert ${invoicedExVat.toFixed(2)} kr eks. mva, forventet ${expectedExVat.toFixed(2)} kr ut fra mottatte varer og avtalte priser.`);
  const lineIssues = out.filter((l) => l.flags.length).length;
  if (lineIssues) issues.push(`${lineIssues} varelinje${lineIssues > 1 ? "r" : ""} har avvik.`);
  return { orderId: order?.id ?? null, ok: issues.length === 0, lines: out, issues, expectedExVat, invoicedExVat, checkedAt: iso() };
}

export async function getDoc<T>(orgId: number, col: string, id: string): Promise<T | null> {
  const p = await db();
  const r = (await p.query("SELECT data FROM docs WHERE org_id = $1 AND col = $2 AND id = $3", [orgId, col, id])).rows[0];
  return r ? ({ ...r.data, id } as T) : null;
}
export async function putDoc(orgId: number, col: string, id: string, data: object, by: number | null) {
  const p = await db();
  const clean = { ...data } as Record<string, unknown>;
  delete clean.id;
  await p.query(
    `INSERT INTO docs (org_id, col, id, data, updated_by, updated_at) VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (org_id, col, id) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [orgId, col, id, JSON.stringify(clean), by]
  );
}

const num = (v: unknown) => (v === "" || v == null ? undefined : Number(String(v).replace(",", ".")));
const str = (v: unknown, max = 120) => String(v ?? "").trim().slice(0, max);
const date = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : "");

export function cleanLines(raw: unknown): Line[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 500).map((l) => ({
    itemNo: str(l?.itemNo ?? l?.varenr, 40),
    description: str(l?.description ?? l?.navn, 160),
    qty: Number(num(l?.qty ?? l?.antall) ?? 0),
    unitPrice: num(l?.unitPrice ?? l?.pris),
    total: num(l?.total ?? l?.sum),
  })).filter((l) => l.itemNo || l.description);
}

/** Validerer og lagrer en faktura, og matcher den med en gang. */
export async function createInvoice(orgId: number, body: Record<string, unknown>, by: { id: number | null; label: string }, source: Invoice["source"]): Promise<Invoice> {
  const supplier = str(body.supplier, 10).toUpperCase();
  const invoiceNo = str(body.invoiceNo, 60);
  const invoiceDate = date(body.invoiceDate) || iso().slice(0, 10);
  if (!supplier || !invoiceNo) throw new Error("Leverandør og fakturanummer må fylles ut.");
  const d = await loadDocs(orgId);
  if (!d.suppliers[supplier]) throw new Error(`Ukjent leverandør «${supplier}». Bruk leverandørkoden fra Innstillinger.`);
  const p = await db();
  const dup = (await p.query("SELECT id FROM docs WHERE org_id = $1 AND col = 'invoices' AND data->>'supplier' = $2 AND data->>'invoiceNo' = $3", [orgId, supplier, invoiceNo])).rows[0];
  if (dup) throw new Error("Fakturaen er allerede registrert for denne leverandøren.");
  const inv: Invoice = {
    supplier, invoiceNo, invoiceDate,
    dueDate: date(body.dueDate) || undefined,
    amountExVat: num(body.amountExVat), vat: num(body.vat), amount: num(body.amount),
    currency: str(body.currency, 3) || "NOK", kid: str(body.kid, 30) || undefined,
    orderId: str(body.orderId, 80) || null, slipId: str(body.slipId, 80) || null, fileId: str(body.fileId, 80) || null,
    lines: cleanLines(body.lines), source, status: "kontroll", ttx: {},
    history: [{ ts: iso(), by: by.label, action: "registrert" }], createdAt: iso(),
  };
  inv.match = matchInvoice(inv, d);
  if (inv.match.orderId) inv.orderId = inv.match.orderId;
  inv.status = !inv.match.orderId ? "kontroll" : inv.match.ok ? "matchet" : "avvik";
  const id = newId();
  await putDoc(orgId, "invoices", id, inv, by.id);
  await audit(by.label, "registrerte faktura", `${supplier} ${invoiceNo}`, orgId);
  return { ...inv, id };
}

/** Pakkseddel. Med receive=true registreres varemottaket på bestillingen med pakkseddelens antall. */
export async function createSlip(orgId: number, body: Record<string, unknown>, by: { id: number | null; label: string }, source: Slip["source"]): Promise<Slip> {
  const supplier = str(body.supplier, 10).toUpperCase();
  const slipNo = str(body.slipNo, 60);
  if (!supplier || !slipNo) throw new Error("Leverandør og pakkseddelnummer må fylles ut.");
  const d = await loadDocs(orgId);
  if (!d.suppliers[supplier]) throw new Error(`Ukjent leverandør «${supplier}».`);
  const lines = cleanLines(body.lines).map((l) => ({ ...l, itemId: itemIdFor(supplier, l.itemNo) }));
  const slip: Slip = { supplier, slipNo, date: date(body.date) || iso().slice(0, 10), orderId: null, fileId: str(body.fileId, 80) || null, lines, received: false, createdAt: iso(), source };
  const order = findOrder(d, supplier, str(body.orderId, 80) || null, slip.date, lines.map((l) => l.itemId!)) as Order | null;
  slip.orderId = order?.id ?? null;
  if (order && body.receive && order.status === "bestilt") {
    const recv = new Map(lines.map((l) => [l.itemId, l.qty]));
    const upd = { ...order, status: "mottatt", deliveryDate: slip.date, receivedTs: Date.now(), slipNo, lines: order.lines.map((l) => ({ ...l, recv: recv.has(l.id) ? recv.get(l.id)! : 0 })) };
    await putDoc(orgId, "orders", order.id, upd, by.id);
    slip.received = true;
  }
  const id = newId();
  await putDoc(orgId, "slips", id, slip, by.id);
  await audit(by.label, "registrerte pakkseddel", `${supplier} ${slipNo}`, orgId);
  return { ...slip, id };
}

export async function rematch(orgId: number, id: string, patch: Partial<Invoice>, by: { id: number | null; label: string }) {
  const inv = await getDoc<Invoice>(orgId, "invoices", id);
  if (!inv) throw new Error("Fant ikke fakturaen.");
  const next: Invoice = { ...inv, ...patch };
  if (patch.lines) next.lines = cleanLines(patch.lines);
  const d = await loadDocs(orgId);
  next.match = matchInvoice(next, d);
  if (next.match.orderId) next.orderId = next.match.orderId;
  if (["kontroll", "avvik", "matchet"].includes(next.status)) next.status = !next.match.orderId ? "kontroll" : next.match.ok ? "matchet" : "avvik";
  next.history = [...(inv.history ?? []), { ts: iso(), by: by.label, action: "matchet på nytt" }];
  await putDoc(orgId, "invoices", id, next, by.id);
  return { ...next, id };
}
