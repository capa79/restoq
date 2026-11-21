// Enkel, robust leser for .xlsx: henter bare celleverdiene (ark, delte tekster, tall, formelresultater).
// Brukes når exceljs ikke klarer filen (f.eks. filer med bilder, pivottabeller, eksterne koblinger eller fra andre programmer).
import JSZip from "jszip";

const MAX_UNZIPPED = 80 * 1024 * 1024; // vern mot «zip-bomber»

const unxml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
const texts = (xml: string) => [...xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((m) => unxml(m[1])).join("");
const colIndex = (ref: string) => { const l = ref.replace(/\d+/g, "").toUpperCase(); let n = 0; for (const ch of l) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

export class SheetFormatError extends Error {}

export async function readXlsxLite(buf: Buffer): Promise<{ name: string; rows: string[][] }[]> {
  const zip = await JSZip.loadAsync(buf);
  const files = Object.values(zip.files) as unknown as { name: string; _data?: { uncompressedSize?: number } }[];
  const total = files.reduce((s, f) => s + (f._data?.uncompressedSize ?? 0), 0);
  if (total > MAX_UNZIPPED) throw new SheetFormatError("Excel-filen er for stor når den pakkes ut.");
  const get = async (p: string) => { const f = zip.file(new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"))[0]; return f ? f.async("string") : null; };

  const wb = await get("xl/workbook.xml");
  if (!wb) {
    if (zip.file("content.xml")) throw new SheetFormatError("Dette er en OpenDocument-fil (.ods). Lagre den som Excel (.xlsx) eller CSV og prøv igjen.");
    if (zip.file(/^Index\//).length) throw new SheetFormatError("Dette er en Numbers-fil. Velg Arkiv → Eksporter til → Excel i Numbers og last opp .xlsx-filen.");
    throw new SheetFormatError("Filen ser ikke ut som et Excel-ark (.xlsx).");
  }
  const rels = (await get("xl/_rels/workbook.xml.rels")) ?? "";
  const target: Record<string, string> = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) { const id = attr(m[0], "Id"); const t = attr(m[0], "Target"); if (id && t) target[id] = t; }
  const ssXml = (await get("xl/sharedStrings.xml")) ?? "";
  const shared = [...ssXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, "")));

  // Datoformater: innebygde (14–22, 45–47) og egne formater med d/m/y
  const stXml = (await get("xl/styles.xml")) ?? "";
  const custom: Record<string, string> = {};
  for (const m of stXml.matchAll(/<numFmt\b[^>]*>/g)) { const id = attr(m[0], "numFmtId"); const code = attr(m[0], "formatCode"); if (id && code) custom[id] = unxml(code); }
  const isDateFmt = (id: number) => (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (custom[id] != null && /[dmy]/i.test(custom[id].replace(/"[^"]*"|\[[^\]]*\]|\\./g, "")) && !/^[#0.,%\s]+$/.test(custom[id]));
  const xfs = stXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "";
  const dateXf = [...xfs.matchAll(/<xf\b[^>]*\/?>/g)].map((m) => isDateFmt(Number(attr(m[0], "numFmtId") ?? 0)));
  const date1904 = /date1904="(1|true)"/.test(wb);
  const serialToDate = (n: number) => { const ms = Math.round((n - (date1904 ? -1462 : 0) - 25569) * 86400000); const d = new Date(ms); return isNaN(d.getTime()) ? String(n) : d.toISOString().slice(0, 10); };

  const out: { name: string; rows: string[][] }[] = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = unxml(attr(m[0], "name") ?? `Ark ${out.length + 1}`);
    const rid = attr(m[0], "r:id") ?? m[0].match(/\s\w+:id="([^"]*)"/)?.[1];
    let t = rid ? target[rid] : undefined;
    if (!t) continue;
    t = t.replace(/^\//, "").replace(/^xl\//i, "");
    const xml = await get(`xl/${t}`);
    if (!xml) continue;
    const rows: string[][] = [];
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      if (rows.length >= 5000) break;
      const vals: string[] = [];
      let next = 0;
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = c[1]; const body = c[2] ?? "";
        const ref = attr(` ${tag}`, "r");
        const i = ref ? colIndex(ref) : next;
        next = i + 1;
        if (i > 200) continue;
        const type = attr(` ${tag}`, "t");
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let val = "";
        if (type === "s") val = v != null ? shared[Number(v)] ?? "" : "";
        else if (type === "inlineStr") val = texts(body);
        else if (type === "b") val = v === "1" ? "TRUE" : v === "0" ? "FALSE" : "";
        else if (v != null && (type == null || type === "n") && dateXf[Number(attr(` ${tag}`, "s") ?? -1)] && !isNaN(Number(v))) val = serialToDate(Number(v));
        else val = v != null ? unxml(v) : "";
        while (vals.length < i) vals.push("");
        vals[i] = val.trim();
      }
      if (vals.some((x) => x)) rows.push(vals);
    }
    if (rows.length) out.push({ name, rows });
  }
  return out;
}
