import { apiUser, canManage, json } from "@/lib/api-auth";
import { logError } from "@/lib/error-log";
import { foodCatsFor, parseSales, readSalesFile, SalesImportError, upsertSalesWeeks } from "@/lib/sales-import";

/**
 * POST /api/sales/import – last opp salgsrapport (Excel/CSV) fra kassesystemet.
 * Skjemafelt: file, weekStart (valgfri, for rapporter uten dato), save=1 for å lagre (ellers bare forhåndsvisning).
 */
export async function POST(req: Request) {
  const u = await apiUser(req, true);
  if (u instanceof Response) return u;
  if (!canManage(u)) return json({ error: "Bare leder kan legge inn salg." }, 403);
  const fd = await req.formData().catch(() => null);
  const f = fd?.get("file");
  if (!f || typeof f === "string") return json({ error: "Ingen fil." }, 400);
  const weekStart = String(fd?.get("weekStart") ?? "").trim() || null;
  const save = fd?.get("save") === "1";
  try {
    const sheets = await readSalesFile(Buffer.from(await f.arrayBuffer()), f.name);
    const res = parseSales(sheets, { foodCats: await foodCatsFor(u.org_id!), weekStart });
    if (!save) return json(res);
    const saved = await upsertSalesWeeks(u.org_id!, res.weeks, { id: u.id, label: u.email }, `fil: ${f.name}`.slice(0, 80));
    return json({ ...res, ...saved });
  } catch (e) {
    if (e instanceof SalesImportError) return json({ error: e.message }, 400);
    await logError({ source: "server", message: `salgsimport: ${(e as Error)?.message ?? e} (${f.name})`, path: "/api/sales/import", orgId: u.org_id, userId: u.id }).catch(() => {});
    return json({ error: "Kunne ikke lese salgsrapporten." }, 500);
  }
}
