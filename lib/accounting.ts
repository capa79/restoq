// Kontoplan fra regnskapssystemet (Tripletex) og kontering av leverandørfakturaer.
// Kontoplanen hentes per kunde og lagres i config/accounting. Koblingen kategori → konto (og ev. mva-kode)
// lagres i innstillingene (settings.accounting.map) og brukes til å lage kontoforslaget i appen.
import { getDoc, putDoc, type Invoice } from "./invoices";
import { listAccounts, listVatTypes } from "./tripletex";

export type AccAccount = { id: number; number: number; name: string; inactive?: boolean; vatTypeId?: number | null };
export type AccVat = { id: number; number: string; name: string; pct: number };
export type AccountingCache = { accounts: AccAccount[]; vatTypes: AccVat[]; fetchedAt: string };

export async function refreshAccounting(orgId: number, byId: number | null): Promise<AccountingCache> {
  const [accounts, vats] = await Promise.all([listAccounts(orgId), listVatTypes(orgId)]);
  const cache: AccountingCache = {
    accounts: accounts.filter((a) => a.number).map((a) => ({ id: a.id, number: Number(a.number), name: a.name, inactive: !!a.isInactive || undefined, vatTypeId: a.vatType?.id ?? null })).sort((a, b) => a.number - b.number),
    vatTypes: vats.map((v) => ({ id: v.id, number: String(v.number ?? ""), name: v.name, pct: Number(v.percentage ?? 0) })),
    fetchedAt: new Date().toISOString(),
  };
  await putDoc(orgId, "config", "accounting", cache, byId);
  return cache;
}

export const getAccounting = (orgId: number) => getDoc<AccountingCache>(orgId, "config", "accounting");

export type PostingIn = { account: number; vatType?: number | null; net: number; description?: string };
export type PostingOut = { accountId: number; account: number; accountName: string; vatTypeId: number | null; vatType: number | null; vatPct: number; net: number; gross: number; description: string };

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Kontrollerer kontoforslaget og regner om til bruttobeløp.
 * - Kontoene må finnes og være aktive i kunden sin kontoplan.
 * - Mva: oppgitt mva-kode, ellers kontoens standard mva-kode, ellers ingen mva.
 * - Summen inkl. mva må gå opp mot fakturabeløpet. Avrunding inntil 1 kr legges på den største linjen.
 */
export function buildPostings(cache: AccountingCache, inv: Invoice, raw: PostingIn[]): { lines: PostingOut[]; total: number; rounding: number } {
  if (!Array.isArray(raw) || !raw.length) throw new Error("Kontoforslaget er tomt.");
  if (raw.length > 50) throw new Error("For mange konteringslinjer.");
  if (inv.amount == null || !isFinite(inv.amount)) throw new Error("Fakturaen mangler beløp inkl. mva. Rett fakturaen først.");
  const acc = new Map(cache.accounts.map((a) => [a.number, a]));
  const vat = new Map(cache.vatTypes.map((v) => [v.id, v]));
  const vatByNo = new Map(cache.vatTypes.map((v) => [v.number, v]));
  const lines: PostingOut[] = raw.map((p) => {
    const a = acc.get(Number(p.account));
    if (!a) throw new Error(`Konto ${p.account} finnes ikke i kontoplanen. Hent kontoplanen på nytt eller velg en annen konto.`);
    if (a.inactive) throw new Error(`Konto ${a.number} ${a.name} er inaktiv i regnskapet.`);
    const net = Number(p.net);
    if (!isFinite(net)) throw new Error("Ugyldig beløp i kontoforslaget.");
    // vatType kan komme som mva-kodens nummer (f.eks. 11) – det er det kunden ser
    const v = p.vatType != null && p.vatType !== ("" as unknown) ? vatByNo.get(String(p.vatType)) : a.vatTypeId != null ? vat.get(a.vatTypeId) : undefined;
    if (p.vatType != null && p.vatType !== ("" as unknown) && !v) throw new Error(`Mva-kode ${p.vatType} finnes ikke i regnskapet.`);
    const pct = v?.pct ?? 0;
    return { accountId: a.id, account: a.number, accountName: a.name, vatTypeId: v?.id ?? null, vatType: v ? Number(v.number) : null, vatPct: pct, net: r2(net), gross: r2(net * (1 + pct / 100)), description: String(p.description ?? "").slice(0, 200) };
  });
  const sum = r2(lines.reduce((s, l) => s + l.gross, 0));
  const diff = r2(inv.amount - sum);
  if (Math.abs(diff) > 1) throw new Error(`Konteringen går ikke opp: linjene inkl. mva blir ${sum.toFixed(2)} kr, men fakturaen er på ${inv.amount.toFixed(2)} kr (differanse ${diff.toFixed(2)} kr). Sjekk mva-kodene og beløpene.`);
  if (diff) { const big = lines.reduce((m, l) => (Math.abs(l.gross) > Math.abs(m.gross) ? l : m), lines[0]); big.gross = r2(big.gross + diff); }
  return { lines, total: inv.amount, rounding: diff };
}
