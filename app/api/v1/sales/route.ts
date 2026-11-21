import { db } from "@/lib/db";
import { v1auth, v1json } from "@/lib/v1";
import { foodCatsFor, parseSales, readSalesFile, SalesImportError, upsertSalesWeeks, weeksFromJson, type SalesWeek } from "@/lib/sales-import";

/** GET /api/v1/sales – salg per uke som er lagret. */
export async function GET(req: Request) {
  const k = await v1auth(req);
  if (k instanceof Response) return k;
  const p = await db();
  const s = (await p.query("SELECT data FROM docs WHERE org_id = $1 AND col = 'config' AND id = 'settings'", [k.orgId])).rows[0]?.data ?? {};
  const weeks = (Array.isArray(s.weeks) ? s.weeks : []) as { wk: number; from: string; sales: number; total?: number; src?: string }[];
  return v1json({ weeks: weeks.map((w) => ({ week: w.wk, weekStart: w.from, food: w.sales, total: w.total ?? null, source: w.src ?? null })) });
}

/**
 * POST /api/v1/sales – salg fra kassesystem eller skript.
 * Body (JSON), ett av:
 *   { "weeks": [ { "weekStart": "2026-11-16", "food": 92770, "total": 224405 } ] }
 *   { "days":  [ { "date": "2026-11-16", "food": 12000, "total": 30100 } ] }   (summeres per uke, mandag–søndag)
 *   { "file":  { "name": "salg.xlsx", "contentBase64": "…" }, "weekStart": "2026-11-16" }   (samme formater som opplasting i appen)
 */
export async function POST(req: Request) {
  const k = await v1auth(req);
  if (k instanceof Response) return k;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return v1json({ error: "bad_request", message: "Ugyldig JSON." }, 400);
  try {
    let weeks: SalesWeek[]; let notes: string[] = [];
    const file = body.file as { name?: string; contentBase64?: string } | undefined;
    if (file?.contentBase64) {
      const sheets = await readSalesFile(Buffer.from(file.contentBase64, "base64"), file.name ?? "salg");
      const r = parseSales(sheets, { foodCats: await foodCatsFor(k.orgId), weekStart: typeof body.weekStart === "string" ? body.weekStart : null });
      weeks = r.weeks; notes = r.notes;
    } else {
      weeks = weeksFromJson(body as Parameters<typeof weeksFromJson>[0]);
    }
    const saved = await upsertSalesWeeks(k.orgId, weeks, { label: k.label }, `api: ${k.label.replace(/^API: /, "")}`.slice(0, 80));
    return v1json({ added: saved.added, updated: saved.updated, weeks: saved.weeks.map((w) => ({ week: w.wk, weekStart: w.from, food: w.sales, total: w.total ?? null })), notes }, 200);
  } catch (e) {
    if (e instanceof SalesImportError) return v1json({ error: "invalid", message: e.message }, 400);
    throw e;
  }
}
