// Tripletex API v2 (https://developer.tripletex.no).
// Restoq er en kommersiell integrasjon: Restoq har ett consumerToken (søkes om hos Tripletex),
// og hver kunde lager et employeeToken i sin Tripletex (Brukerinnstillinger → API-tilgang).
// Øktnøkkel: PUT /token/session/:create?consumerToken&employeeToken&expirationDate,
// brukes som passord i Basic Auth med brukernavn 0. Gjelder til midnatt på utløpsdatoen.
import { db } from "./db";
import { decrypt, encrypt } from "./crypto";

export const tripletexBase = () =>
  (process.env.TRIPLETEX_ENV === "prod" ? "https://tripletex.no/v2" : "https://api-test.tripletex.tech/v2").replace(/\/$/, "");
export const tripletexConfigured = () => Boolean(process.env.TRIPLETEX_CONSUMER_TOKEN && (process.env.SECRET_KEY ?? "").length >= 32);

export class TripletexError extends Error {
  constructor(message: string, public status = 0) {
    super(message);
  }
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

async function createSession(employeeToken: string): Promise<{ token: string; expires: string }> {
  const expires = isoDate(new Date(Date.now() + 2 * 864e5));
  const q = new URLSearchParams({ consumerToken: process.env.TRIPLETEX_CONSUMER_TOKEN!, employeeToken, expirationDate: expires });
  const res = await fetch(`${tripletexBase()}/token/session/:create?${q}`, { method: "PUT", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new TripletexError(res.status === 403 || res.status === 401 ? "Tripletex godtok ikke nøkkelen. Sjekk at API-nøkkelen er laget for Restoq og ikke er slettet." : `Tripletex svarte ${res.status} ved innlogging.`, res.status);
  const j = (await res.json()) as { value?: { token?: string } };
  if (!j.value?.token) throw new TripletexError("Tripletex sendte ingen øktnøkkel.");
  return { token: j.value.token, expires };
}

/** Lagrer kundens employeeToken kryptert og tester det. */
export async function connectTripletex(orgId: number, employeeToken: string) {
  const s = await createSession(employeeToken.trim());
  const who = await rawCall(s.token, "GET", "/token/session/>whoAmI");
  const p = await db();
  const info = { companyId: who?.value?.company?.id ?? who?.value?.companyId ?? null, employee: who?.value?.employee?.id ?? null, connectedAt: new Date().toISOString() };
  await p.query(
    `INSERT INTO integrations (org_id, provider, secret, info, session_token, session_expires) VALUES ($1, 'tripletex', $2, $3, $4, $5)
     ON CONFLICT (org_id, provider) DO UPDATE SET secret = EXCLUDED.secret, info = EXCLUDED.info, session_token = EXCLUDED.session_token, session_expires = EXCLUDED.session_expires`,
    [orgId, encrypt(employeeToken.trim()), JSON.stringify(info), encrypt(s.token), s.expires]
  );
  return info;
}

export async function tripletexStatus(orgId: number) {
  const p = await db();
  const r = (await p.query("SELECT info, created_at FROM integrations WHERE org_id = $1 AND provider = 'tripletex'", [orgId])).rows[0];
  return { available: tripletexConfigured(), connected: !!r, env: process.env.TRIPLETEX_ENV === "prod" ? "prod" : "test", info: r?.info ?? null };
}

export async function disconnectTripletex(orgId: number) {
  const p = await db();
  await p.query("DELETE FROM integrations WHERE org_id = $1 AND provider = 'tripletex'", [orgId]);
}

async function sessionFor(orgId: number): Promise<string> {
  if (!tripletexConfigured()) throw new TripletexError("Tripletex-koblingen er ikke satt opp på serveren (TRIPLETEX_CONSUMER_TOKEN og SECRET_KEY).");
  const p = await db();
  const r = (await p.query("SELECT secret, session_token, session_expires FROM integrations WHERE org_id = $1 AND provider = 'tripletex'", [orgId])).rows[0];
  if (!r) throw new TripletexError("Tripletex er ikke koblet til. Leder kobler til under Innstillinger.");
  const today = isoDate(new Date());
  if (r.session_token && r.session_expires && isoDate(new Date(r.session_expires)) > today) return decrypt(r.session_token);
  const s = await createSession(decrypt(r.secret));
  await p.query("UPDATE integrations SET session_token = $2, session_expires = $3 WHERE org_id = $1 AND provider = 'tripletex'", [orgId, encrypt(s.token), s.expires]);
  return s.token;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rawCall(token: string, method: string, path: string, body?: BodyInit, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(`${tripletexBase()}${path}`, {
    method,
    headers: { Authorization: "Basic " + Buffer.from(`0:${token}`).toString("base64"), Accept: "application/json", ...headers },
    body,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let j: any = null;
  try {
    j = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok) {
    const msg = j?.validationMessages?.map((v: { message: string }) => v.message).join("; ") || j?.message || `HTTP ${res.status}`;
    throw new TripletexError(`Tripletex: ${msg}`, res.status);
  }
  return j;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ttx(orgId: number, method: string, path: string, body?: BodyInit, headers?: Record<string, string>): Promise<any> {
  return rawCall(await sessionFor(orgId), method, path, body, headers);
}

/** Laster opp faktura/pakkseddel (PDF, PNG, JPEG, TIFF eller EHF) til bilagsmottaket i Tripletex. */
export async function importDocument(orgId: number, file: { name: string; mime: string; data: Buffer }, description: string) {
  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array(file.data)], { type: file.mime }), file.name);
  if (description) fd.append("description", description.slice(0, 250));
  const j = await ttx(orgId, "POST", "/ledger/voucher/importDocument", fd);
  const vouchers = (j?.values ?? (j?.value ? [j.value] : [])) as { id: number }[];
  return vouchers.map((v) => v.id);
}

export type TtxSupplierInvoice = {
  id: number;
  invoiceNumber?: string;
  invoiceDate?: string;
  invoiceDueDate?: string;
  amount?: number;
  amountExcludingVat?: number;
  amountCurrency?: number;
  supplier?: { id: number; name?: string; organizationNumber?: string };
  voucher?: { id: number };
};

/** Leverandørfakturaer i Tripletex (bl.a. EHF som kommer rett inn dit). */
export async function listSupplierInvoices(orgId: number, from: string, to: string): Promise<TtxSupplierInvoice[]> {
  const q = new URLSearchParams({ invoiceDateFrom: from, invoiceDateTo: to, count: "500", fields: "id,invoiceNumber,invoiceDate,invoiceDueDate,amount,amountExcludingVat,amountCurrency,supplier(id,name,organizationNumber),voucher(id)" });
  const j = await ttx(orgId, "GET", `/supplierInvoice?${q}`);
  return (j?.values ?? []) as TtxSupplierInvoice[];
}

export async function approveSupplierInvoice(orgId: number, ttxId: number, comment: string) {
  const q = new URLSearchParams(comment ? { comment: comment.slice(0, 250) } : {});
  return ttx(orgId, "PUT", `/supplierInvoice/${ttxId}/:approve?${q}`);
}

/** Legger fakturaen til betaling i Tripletex. Selve utbetalingen krever bankintegrasjon (autobank) i Tripletex. */
export async function addSupplierPayment(orgId: number, ttxId: number, opts: { paymentType?: number; amount?: number; paymentDate?: string }) {
  const q = new URLSearchParams({ paymentType: String(opts.paymentType ?? Number(process.env.TRIPLETEX_PAYMENT_TYPE ?? 0)) });
  if (opts.amount) q.set("amount", String(opts.amount));
  if (opts.paymentDate) q.set("paymentDate", opts.paymentDate);
  return ttx(orgId, "POST", `/supplierInvoice/${ttxId}/:addPayment?${q}`);
}
