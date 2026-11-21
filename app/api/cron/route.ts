import { db } from "@/lib/db";
import { json } from "@/lib/api-auth";
import { syncTripletexInbox } from "@/lib/ttx-inbox";
import { syncPlanday } from "@/lib/planday";
import { logError } from "@/lib/error-log";

// Planlagt henting for alle kunder (Render Cron Job eller annen planlegger):
//   GET /api/cron med «Authorization: Bearer <CRON_SECRET>»
// Henter fakturaer fra bilagsmottaket i Tripletex og omsetning fra Planday.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < 16 || req.headers.get("authorization") !== `Bearer ${secret}`) return json({ error: "Ikke tilgang." }, 401);
  const p = await db();
  const rows = (await p.query("SELECT org_id, provider, info FROM integrations WHERE provider IN ('tripletex','planday')")).rows as { org_id: number; provider: string; info: { inboxAuto?: boolean } }[];
  const out: Record<string, unknown>[] = [];
  for (const r of rows) {
    try {
      if (r.provider === "tripletex" && r.info?.inboxAuto !== false) out.push({ org: r.org_id, tripletex: await syncTripletexInbox(r.org_id, { id: null, label: "Restoq (automatisk)" }) });
      if (r.provider === "planday") out.push({ org: r.org_id, planday: await syncPlanday(r.org_id, null) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out.push({ org: r.org_id, provider: r.provider, error: msg });
      await logError({ source: "server", message: `cron ${r.provider}: ${msg}`, path: "/api/cron", orgId: r.org_id }).catch(() => {});
    }
  }
  return json({ ok: true, ran: out.length, results: out });
}
