// Salg per uke: les salgsrapporter (Excel/CSV) eller tall fra kassesystem/API og lagre dem som uker i config/settings.
// Forstår tre formater:
//  1. Uketabell: én rad per uke med dato (mandag) eller ukenummer, matsalg og ev. totalomsetning.
//  2. Dagstabell: én rad per dag med dato og beløp – summeres per ISO-uke (mandag–søndag).
//  3. Salgsrapport per vare/kategori fra kassen (f.eks. Katria «Sales per Item»): kategorier summeres,
//     mat = kategoriene i «Matkategorier», totalt = alle rader. Perioden hentes fra en datokolonne,
//     fra teksten øverst i rapporten («16.11.2026 – 22.11.2026») eller fra valgt uke.
import { audit, db } from "./db";
import { readXlsxLite, SheetFormatError } from "./xlsx-lite";

export type SalesWeek = { from: string; sales: number; total?: number };
export type Sheet = { name: string; rows: string[][] };
export type ParseResult = { format: "uker" | "dager" | "kategorier"; weeks: SalesWeek[]; notes: string[] };
export class SalesImportError extends Error {}

export const DEFAULT_FOOD_CATS = ["Brunch", "Evening dishes", "Sweets", "Sides", "Sandwiches", "Desserts"];

/* ---------- små hjelpere ---------- */
const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
/** Mandagen i uka datoen hører til (YYYY-MM-DD). */
export function monday(dateIso: string) { const d = new Date(dateIso + "T00:00:00Z"); const wd = (d.getUTCDay() + 6) % 7; return iso(new Date(d.getTime() - wd * DAY)); }
export function isoWeekNo(dateIso: string) { const t = new Date(dateIso + "T00:00:00Z"); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y0 = Date.UTC(t.getUTCFullYear(), 0, 1); return Math.ceil(((t.getTime() - y0) / DAY + 1) / 7); }
/** Mandag i ISO-uke nr. w i år y. */
function mondayOfIsoWeek(y: number, w: number) { const jan4 = utc(y, 1, 4); const wd = (jan4.getUTCDay() + 6) % 7; return iso(new Date(jan4.getTime() - wd * DAY + (w - 1) * 7 * DAY)); }

/** Tolker 2026-11-16, 16.11.2026, 16.11.26, 16/11/2026, 2026-11-16T00:00:00Z og Excel-serienummer. */
export function parseDate(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(?:\s.*)?$/.exec(s);
  if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return valid(y, +m[2], +m[1]); }
  if (/^\d{5}(\.\d+)?$/.test(s)) { const n = Number(s); if (n > 40000 && n < 60000) return iso(new Date(Math.round((n - 25569) * DAY))); }
  return null;
}
function valid(y: number, mo: number, d: number) { if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null; const dt = utc(y, mo, d); return dt.getUTCMonth() === mo - 1 ? iso(dt) : null; }

/** Tolker «1 234,56», «1.234,56», «1,234.56», «kr 1234», «-500». Tom tekst → null. */
export function parseAmount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v ?? "").replace(/ | /g, " ").replace(/kr|nok|,-/gi, "").trim();
  if (!s) return null;
  s = s.replace(/\s/g, "");
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else s = s.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}
const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const round = (n: number) => Math.round(n);

/* ---------- lesing av fil ---------- */
export function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, "");
  const first = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const counts = [";", ",", "\t"].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1]);
  const delim = counts[0][1] > 1 ? counts[0][0] : ";";
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === delim) { row.push(cell.trim()); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell.trim()); if (row.some((x) => x)) rows.push(row); row = []; cell = ""; if (rows.length >= 20000) break; }
    else cell += c;
  }
  row.push(cell.trim()); if (row.some((x) => x)) rows.push(row);
  return rows;
}

export async function readSalesFile(buf: Buffer, name: string): Promise<Sheet[]> {
  if (buf.length > 5 * 1024 * 1024) throw new SalesImportError("Filen er større enn 5 MB.");
  if (buf.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) throw new SalesImportError("Dette er en gammel Excel-fil (.xls). Lagre den som .xlsx eller CSV og prøv igjen.");
  if (buf.subarray(0, 2).toString("latin1") === "PK") {
    try { return await readXlsxLite(buf); } catch (e) { if (e instanceof SheetFormatError) throw new SalesImportError(e.message); throw new SalesImportError("Kunne ikke lese Excel-filen. Lagre den på nytt som .xlsx eller CSV."); }
  }
  if (/\.pdf$/i.test(name) || buf.subarray(0, 4).toString("latin1") === "%PDF") throw new SalesImportError("PDF kan ikke leses her. Eksporter rapporten som Excel eller CSV fra kassesystemet.");
  let text = buf.toString("utf8");
  if (text.includes("�")) text = buf.toString("latin1");
  return [{ name, rows: parseCsv(text) }];
}

/* ---------- gjenkjenning av kolonner ---------- */
const RX = {
  week: /^(uke|uke ?nr\.?|week|week ?no\.?|wk|iso-?uke)$/,
  date: /^(dato|date|dag|day|fra|fra \(mandag\)|uke starter|week start(ing)?|periode ?start|from|start|business ?date|salgsdato)/,
  food: /(matsalg|salg mat|mat \(|^mat$|food ?sales|^food$|kitchen|kjøkken)/,
  total: /(omsetning totalt|salg totalt|total ?(sales|omsetning|revenue|netto|net)|^omsetning$|^totalt?$|^sum$|grand total|^revenue$|netto ?salg|net ?sales)/,
  category: /^(kategori|category|hovedkategori|main category|varegruppe|product ?group|item ?group|group|gruppe|department|avdeling|meny ?kategori|menu ?category)$/,
  amount: /(netto|^net|net amount|net sales|eks\.? ?mva|excl\.? ?vat|ex\.? ?vat|beløp|belop|amount|sum|omsetning|sales|salg|turnover|revenue)/,
  gross: /(brutto|gross|inkl\.? ?mva|incl\.? ?vat|mva-?beløp|vat amount|^mva$|^vat$|antall|qty|quantity|count|rabatt|discount|pris|price|kostpris|cost)/,
};
const SKIP_ROW = /^(sum|total|totalt|grand total|subtotal|delsum|i alt|alle|all)\b/;

type Head = { r: number; cols: string[] };
function findHead(rows: string[][], test: (cols: string[]) => boolean): Head | null {
  for (let r = 0; r < Math.min(rows.length, 30); r++) { const cols = rows[r].map(norm); if (test(cols)) return { r, cols }; }
  return null;
}
const idx = (cols: string[], rx: RegExp, not?: RegExp) => cols.findIndex((c) => c && rx.test(c) && !(not && not.test(c)));

/** Prøver å finne en periode («16.11.2026 – 22.11.2026») i tekstradene over tabellen. */
function periodFromText(rows: string[][], before: number): { from: string; to: string } | null {
  const dates: string[] = [];
  for (let r = 0; r < Math.min(before, 15); r++) for (const c of rows[r]) for (const m of String(c).matchAll(/\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{2,4}/g)) { const d = parseDate(m[0]); if (d) dates.push(d); }
  if (!dates.length) return null;
  dates.sort();
  return { from: dates[0], to: dates[dates.length - 1] };
}

/* ---------- tolking ---------- */
export function parseSales(sheets: Sheet[], opts: { foodCats?: string[]; weekStart?: string | null; year?: number } = {}): ParseResult {
  const foodCats = (opts.foodCats?.length ? opts.foodCats : DEFAULT_FOOD_CATS).map(norm);
  const errors: string[] = [];
  for (const sh of sheets) {
    const rows = sh.rows;
    if (!rows.length) continue;

    // 1/2: tabell med dato eller uke + matsalg (og ev. total)
    const h = findHead(rows, (c) => idx(c, RX.food) >= 0 && (idx(c, RX.date) >= 0 || idx(c, RX.week) >= 0));
    if (h) {
      const cFood = idx(h.cols, RX.food, /andel|%|share/), cTot = idx(h.cols, RX.total, /andel|%|share/);
      const cDate = idx(h.cols, RX.date, /(^|[\s(])(til|to)\b|slutt|\bend/), cWeek = idx(h.cols, RX.week);
      const year = opts.year ?? new Date().getUTCFullYear();
      const byWeek = new Map<string, { sales: number; total: number | null; days: number }>();
      let daily = false, n = 0;
      for (const row of rows.slice(h.r + 1)) {
        if (SKIP_ROW.test(norm(row[0]))) continue;
        const food = parseAmount(row[cFood]);
        if (food == null) continue;
        let d = cDate >= 0 ? parseDate(row[cDate]) : null;
        if (!d && cWeek >= 0) { const w = Number(String(row[cWeek]).replace(/\D/g, "")); if (w >= 1 && w <= 53) d = mondayOfIsoWeek(year, w); }
        if (!d) continue;
        const from = monday(d); if (from !== d) daily = true;
        const tot = cTot >= 0 ? parseAmount(row[cTot]) : null;
        const cur = byWeek.get(from) ?? { sales: 0, total: null, days: 0 };
        cur.sales += food; if (tot != null) cur.total = (cur.total ?? 0) + tot; cur.days++;
        byWeek.set(from, cur); n++;
      }
      if (n) {
        const notes: string[] = [];
        if (cTot < 0) notes.push("Fant ingen kolonne for totalomsetning – bare matsalg lagres.");
        if (cDate < 0) notes.push(`Ukene er tolket som ISO-uker i ${year}.`);
        const weeks = [...byWeek.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([from, v]) => ({ from, sales: round(v.sales), ...(v.total != null ? { total: round(v.total) } : {}) }));
        if (daily) { const part = [...byWeek.entries()].filter(([, v]) => v.days < 7).map(([f]) => `uke ${isoWeekNo(f)}`); if (part.length) notes.push(`Ikke hele uka med dager i filen: ${part.join(", ")}. Last opp på nytt når uka er ferdig.`); }
        return { format: daily ? "dager" : "uker", weeks, notes };
      }
    }

    // 3: rapport per kategori/vare
    const hc = findHead(rows, (c) => idx(c, RX.category) >= 0 && idx(c, RX.amount, RX.gross) >= 0);
    if (hc) {
      const cCat = idx(hc.cols, RX.category);
      // Foretrekk netto eks. mva hvis det finnes flere beløpskolonner
      const amountCols = hc.cols.map((c, i) => ({ c, i })).filter((x) => x.c && RX.amount.test(x.c) && !RX.gross.test(x.c));
      const cAmt = (amountCols.find((x) => /netto|net|eks|excl|ex\.? ?vat/.test(x.c)) ?? amountCols[amountCols.length - 1]).i;
      const cDate = idx(hc.cols, RX.date, /(^|[\s(])(til|to)\b|slutt|\bend/);
      const p = periodFromText(rows, hc.r);
      const fallback = opts.weekStart ? monday(opts.weekStart) : p ? monday(p.from) : null;
      const byWeek = new Map<string, { sales: number; total: number }>();
      const seen = new Set<string>(); let n = 0;
      for (const row of rows.slice(hc.r + 1)) {
        const cat = norm(row[cCat]);
        if (!cat || SKIP_ROW.test(cat)) continue;
        const amt = parseAmount(row[cAmt]);
        if (amt == null) continue;
        const d = cDate >= 0 ? parseDate(row[cDate]) : null;
        const from = d ? monday(d) : fallback;
        if (!from) continue;
        const cur = byWeek.get(from) ?? { sales: 0, total: 0 };
        cur.total += amt; if (foodCats.includes(cat)) cur.sales += amt;
        byWeek.set(from, cur); seen.add(cat); n++;
      }
      if (!n && !fallback && cDate < 0) { errors.push("Fant salg per kategori, men ikke hvilken uke rapporten gjelder. Velg uka før du laster opp."); continue; }
      if (n) {
        const notes: string[] = [];
        if (cDate < 0 && p && (p.to < addDays(monday(p.from), 6) || monday(p.to) !== monday(p.from))) notes.push(`Rapporten gjelder ${p.from} – ${p.to}, ikke nøyaktig én hel uke (mandag–søndag). Kontroller tallene.`);
        const food = [...seen].filter((c) => foodCats.includes(c));
        if (!food.length) notes.push("Ingen av kategoriene i rapporten står i «Matkategorier». Rett listen og last opp på nytt.");
        else notes.push(`Matsalg = ${food.join(", ")}. Andre kategorier teller bare i totalen: ${[...seen].filter((c) => !foodCats.includes(c)).join(", ") || "ingen"}.`);
        const weeks = [...byWeek.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([from, v]) => ({ from, sales: round(v.sales), total: round(v.total) }));
        return { format: "kategorier", weeks, notes };
      }
    }
  }
  throw new SalesImportError(errors[0] ?? "Fant ikke salgstall i filen. Filen må ha kolonner for dato eller uke og matsalg, eller kategori og netto beløp.");
}
function addDays(d: string, n: number) { return iso(new Date(new Date(d + "T00:00:00Z").getTime() + n * DAY)); }

/* ---------- tall fra API (JSON) ---------- */
type InWeek = { weekStart?: unknown; from?: unknown; week?: unknown; year?: unknown; food?: unknown; sales?: unknown; total?: unknown };
type InDay = { date?: unknown; food?: unknown; sales?: unknown; total?: unknown };
export function weeksFromJson(body: { weeks?: InWeek[]; days?: InDay[] }): SalesWeek[] {
  const out = new Map<string, { sales: number; total: number | null }>();
  for (const w of body.weeks ?? []) {
    let d = parseDate(w.weekStart ?? w.from);
    if (!d && w.week != null) { const y = Number(w.year ?? new Date().getUTCFullYear()); const n = Number(w.week); if (n >= 1 && n <= 53) d = mondayOfIsoWeek(y, n); }
    const food = parseAmount(w.food ?? w.sales);
    if (!d || food == null) throw new SalesImportError(`Ugyldig uke: ${JSON.stringify(w).slice(0, 120)} (trenger weekStart og food).`);
    const tot = parseAmount(w.total);
    out.set(monday(d), { sales: food, total: tot });
  }
  for (const x of body.days ?? []) {
    const d = parseDate(x.date); const food = parseAmount(x.food ?? x.sales);
    if (!d || food == null) throw new SalesImportError(`Ugyldig dag: ${JSON.stringify(x).slice(0, 120)} (trenger date og food).`);
    const k = monday(d); const cur = out.get(k) ?? { sales: 0, total: null };
    cur.sales += food; const t = parseAmount(x.total); if (t != null) cur.total = (cur.total ?? 0) + t;
    out.set(k, cur);
  }
  return [...out.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([from, v]) => ({ from, sales: round(v.sales), ...(v.total != null ? { total: round(v.total) } : {}) }));
}

/** Sjekker tallene før lagring. */
export function validateWeeks(weeks: SalesWeek[]) {
  if (!weeks.length) throw new SalesImportError("Ingen uker å lagre.");
  if (weeks.length > 400) throw new SalesImportError("For mange uker i én forespørsel (maks 400).");
  for (const w of weeks) {
    if (!(w.sales >= 0) || w.sales > 1e9) throw new SalesImportError(`Ugyldig matsalg for uka ${w.from}.`);
    if (w.total != null && w.total < w.sales) throw new SalesImportError(`Uka ${w.from}: salg totalt (${w.total}) er lavere enn salg mat (${w.sales}).`);
  }
}

/* ---------- lagring ---------- */
/** Legger ukene inn i config/settings.weeks (erstatter uker med samme mandag). Låser raden så samtidige lagringer ikke overskriver hverandre. */
export async function upsertSalesWeeks(orgId: number, weeks: SalesWeek[], actor: { id?: number | null; label: string }, source: string) {
  validateWeeks(weeks);
  const p = await db();
  const c = await p.connect();
  try {
    await c.query("BEGIN");
    const cur = (await c.query("SELECT data FROM docs WHERE org_id = $1 AND col = 'config' AND id = 'settings' FOR UPDATE", [orgId])).rows[0]?.data ?? {};
    const list: { wk: number; from: string; sales: number; total?: number; src?: string }[] = Array.isArray(cur.weeks) ? cur.weeks : [];
    let added = 0, updated = 0;
    for (const w of weeks) {
      const i = list.findIndex((x) => x.from === w.from);
      const old = i >= 0 ? list[i] : null;
      const next = { wk: isoWeekNo(w.from), from: w.from, sales: w.sales, ...(w.total != null ? { total: w.total } : old?.total != null ? { total: old.total } : {}), src: source };
      if (i >= 0) { list[i] = next; updated++; } else { list.push(next); added++; }
    }
    list.sort((a, b) => (a.from < b.from ? -1 : 1));
    const data = { ...cur, weeks: list };
    await c.query(
      `INSERT INTO docs (org_id, col, id, data, updated_by, updated_at) VALUES ($1, 'config', 'settings', $2, $3, now())
       ON CONFLICT (org_id, col, id) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [orgId, JSON.stringify(data), actor.id ?? null]
    );
    // Statuslys «Kassesystem» i appen
    await c.query(
      `INSERT INTO integrations (org_id, provider, secret, info) VALUES ($1, 'pos', '', $2)
       ON CONFLICT (org_id, provider) DO UPDATE SET info = integrations.info || (EXCLUDED.info - 'connectedAt')
         || CASE WHEN integrations.info ? 'connectedAt' OR NOT EXCLUDED.info ? 'connectedAt' THEN '{}'::jsonb
                 ELSE jsonb_build_object('connectedAt', EXCLUDED.info->'connectedAt') END`,
      [orgId, JSON.stringify({ lastSync: new Date().toISOString(), lastSource: source, ...(source.startsWith("api") ? { connectedAt: new Date().toISOString() } : {}) })]
    );
    await c.query("COMMIT");
    await audit(actor.label, `salg per uke (${source})`, `${added} nye, ${updated} oppdatert: ${weeks.map((w) => w.from).join(", ")}`, orgId);
    return { added, updated, weeks: list.filter((x) => weeks.some((w) => w.from === x.from)) };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Matkategoriene som er lagret for kunden (Innstillinger → Salg per uke). */
export async function foodCatsFor(orgId: number) {
  const p = await db();
  const s = (await p.query("SELECT data FROM docs WHERE org_id = $1 AND col = 'config' AND id = 'settings'", [orgId])).rows[0]?.data;
  const cats = s?.salesImport?.foodCats;
  return Array.isArray(cats) && cats.length ? (cats as string[]) : DEFAULT_FOOD_CATS;
}
