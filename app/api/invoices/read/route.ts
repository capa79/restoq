import { apiUser, ID_RE, json } from "@/lib/api-auth";
import { audit, db } from "@/lib/db";
import { readFile } from "@/lib/files";
import { invoiceReaderEnabled, readInvoice } from "@/lib/invoice-reader";

const DAILY_LIMIT = 150; // per kunde, for å holde kostnaden nede

// Leser en opplastet faktura med Claude: { fileId } -> leverandør, beløp og varelinjer til godkjenning.
export async function POST(req: Request) {
  const u = await apiUser(req, true);
  if (u instanceof Response) return u;
  if (!invoiceReaderEnabled()) return json({ error: "Automatisk lesing er ikke satt opp (ANTHROPIC_API_KEY i Render)." }, 503);
  const body = await req.json().catch(() => ({}));
  const fileId = String(body?.fileId ?? "");
  if (!ID_RE.test(fileId)) return json({ error: "Ugyldig fil." }, 400);
  const f = await readFile(u.org_id!, fileId);
  if (!f) return json({ error: "Fant ikke filen." }, 404);
  const p = await db();
  const used = Number((await p.query("SELECT count(*)::int AS n FROM audit WHERE org_id = $1 AND action = 'leste faktura med Claude' AND created_at > now() - interval '24 hours'", [u.org_id])).rows[0].n);
  if (used >= DAILY_LIMIT) return json({ error: `Grensen på ${DAILY_LIMIT} automatiske lesinger per døgn er nådd. Registrer fakturaen manuelt.` }, 429);
  try {
    const inv = await readInvoice(f);
    await audit(u.email, "leste faktura med Claude", `${f.name} · ${inv.lines.length} linjer`, u.org_id);
    return json({ invoice: inv });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Kunne ikke lese fakturaen." }, 502);
  }
}
