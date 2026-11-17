import { db } from "./db";
import { newId } from "./invoices";

export const MAX_FILE = 10 * 1024 * 1024;
const OK_MIME = ["application/pdf", "image/png", "image/jpeg", "image/tiff", "image/webp", "application/xml", "text/xml"];

/** Sjekker filtypen ut fra innholdet, ikke bare filnavnet. */
function sniff(buf: Buffer, declared: string): string | null {
  if (buf.subarray(0, 4).toString("latin1") === "%PDF") return "application/pdf";
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString("latin1") === "PNG") return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if ((buf[0] === 0x49 && buf[1] === 0x49) || (buf[0] === 0x4d && buf[1] === 0x4d)) return "image/tiff";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  const head = buf.subarray(0, 200).toString("utf8").trimStart();
  if (head.startsWith("<?xml") || head.startsWith("<Invoice") || head.startsWith("<StandardBusinessDocument")) return "application/xml";
  return OK_MIME.includes(declared) ? null : null;
}

export async function saveFile(orgId: number, name: string, declared: string, data: Buffer, by: number | null) {
  if (data.length === 0) throw new Error("Filen er tom.");
  if (data.length > MAX_FILE) throw new Error("Filen er større enn 10 MB.");
  const mime = sniff(data, declared);
  if (!mime) throw new Error("Bare PDF, bilde (PNG/JPEG/TIFF/WebP) eller EHF (XML) kan lastes opp.");
  const id = newId();
  const safe = name.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120) || "dokument";
  const p = await db();
  await p.query("INSERT INTO files (org_id, id, name, mime, size, data, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)", [orgId, id, safe, mime, data.length, data, by]);
  return { id, name: safe, mime, size: data.length };
}

export async function readFile(orgId: number, id: string) {
  const p = await db();
  const r = (await p.query("SELECT name, mime, data FROM files WHERE org_id = $1 AND id = $2", [orgId, id])).rows[0];
  return r ? { name: r.name as string, mime: r.mime as string, data: r.data as Buffer } : null;
}
