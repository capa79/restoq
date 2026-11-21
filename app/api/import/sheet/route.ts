import ExcelJS from "exceljs";
import { apiUser, json } from "@/lib/api-auth";
import { logError } from "@/lib/error-log";
import { readXlsxLite, SheetFormatError } from "@/lib/xlsx-lite";

// Leser første ark i en Excel-fil (.xlsx) og returnerer radene som tekst. Brukes av «Kom i gang» og vareimport.
export async function POST(req: Request) {
  const u = await apiUser(req, true);
  if (u instanceof Response) return u;
  const fd = await req.formData().catch(() => null);
  const f = fd?.get("file");
  if (!f || typeof f === "string") return json({ error: "Ingen fil." }, 400);
  if (f.size > 5 * 1024 * 1024) return json({ error: "Filen er større enn 5 MB." }, 413);
  const buf = Buffer.from(await f.arrayBuffer());
  if (buf.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) return json({ error: "Dette er en gammel Excel-fil (.xls). Åpne den i Excel og velg Lagre som → Excel-arbeidsbok (.xlsx), eller lagre som CSV, og last opp på nytt." }, 400);
  if (buf.subarray(0, 2).toString("latin1") !== "PK") return json({ error: "Bare Excel-filer (.xlsx) og CSV kan leses her." }, 400);
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const sheets = wb.worksheets.map((ws) => {
      const rows: string[][] = [];
      ws.eachRow({ includeEmpty: false }, (row) => {
        if (rows.length >= 5000) return;
        const vals = (row.values as unknown[]).slice(1).map((v) => {
          if (v == null) return "";
          if (typeof v === "object") {
            const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[]; hyperlink?: string };
            if (o.result != null) return String(o.result);
            if (o.richText) return o.richText.map((r) => r.text).join("");
            if (o.text != null) return String(o.text);
            if (v instanceof Date) return v.toISOString().slice(0, 10);
            return "";
          }
          return String(v);
        });
        rows.push(vals.map((s) => s.trim()));
      });
      return { name: ws.name, rows: rows.filter((r) => r.some((x) => x)) };
    }).filter((s) => s.rows.length);
    if (sheets.length) return json({ sheets: sheets.slice(0, 10) });
  } catch (e) {
    // exceljs klarer ikke alle filer (bilder, pivottabeller, filer fra andre programmer) – prøv den enkle leseren
    await logError({ source: "server", message: `exceljs: ${(e as Error)?.message ?? e} (${f.name})`, path: "/api/import/sheet", orgId: u.org_id, userId: u.id }).catch(() => {});
  }
  try {
    const sheets = await readXlsxLite(buf);
    if (!sheets.length) return json({ error: "Fant ingen rader med innhold i Excel-filen." }, 400);
    return json({ sheets: sheets.slice(0, 10) });
  } catch (e) {
    if (e instanceof SheetFormatError) return json({ error: e.message }, 400);
    await logError({ source: "server", message: `xlsx-lite: ${(e as Error)?.message ?? e} (${f.name})`, path: "/api/import/sheet", orgId: u.org_id, userId: u.id }).catch(() => {});
    return json({ error: "Kunne ikke lese Excel-filen. Prøv å lagre den på nytt som .xlsx eller CSV." }, 400);
  }
}
