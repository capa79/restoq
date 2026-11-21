import ExcelJS from "exceljs";
import { apiUser, json } from "@/lib/api-auth";

// Leser første ark i en Excel-fil (.xlsx) og returnerer radene som tekst. Brukes av «Kom i gang» og vareimport.
export async function POST(req: Request) {
  const u = await apiUser(req, true);
  if (u instanceof Response) return u;
  const fd = await req.formData().catch(() => null);
  const f = fd?.get("file");
  if (!f || typeof f === "string") return json({ error: "Ingen fil." }, 400);
  if (f.size > 5 * 1024 * 1024) return json({ error: "Filen er større enn 5 MB." }, 413);
  const buf = Buffer.from(await f.arrayBuffer());
  if (buf.subarray(0, 2).toString("latin1") !== "PK") return json({ error: "Bare Excel-filer (.xlsx) kan leses her. Gamle .xls-filer må lagres som .xlsx eller CSV." }, 400);
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
    return json({ sheets: sheets.slice(0, 10) });
  } catch {
    return json({ error: "Kunne ikke lese Excel-filen." }, 400);
  }
}
