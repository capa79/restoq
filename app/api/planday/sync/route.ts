import { apiUser, json } from "@/lib/api-auth";
import { syncPlanday } from "@/lib/planday";

const day = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : undefined);

/** Henter omsetningsplan og faktisk omsetning fra Planday. Alle innloggede kan oppdatere. */
export async function POST(req: Request) {
  const u = await apiUser(req, true);
  if (u instanceof Response) return u;
  const b = await req.json().catch(() => ({}));
  try {
    return json(await syncPlanday(u.org_id!, u.id, day(b.from), day(b.to)));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Kunne ikke hente fra Planday." }, 400);
  }
}
