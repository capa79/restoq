import { audit } from "@/lib/db";
import { apiUser, canManage, json } from "@/lib/api-auth";
import { getAccounting, refreshAccounting } from "@/lib/accounting";
import { TripletexError } from "@/lib/tripletex";

/** Kontoplan og mva-koder fra regnskapet (lagret kopi). */
export async function GET(req: Request) {
  const u = await apiUser(req);
  if (u instanceof Response) return u;
  return json((await getAccounting(u.org_id!)) ?? { accounts: [], vatTypes: [], fetchedAt: null });
}

/** Henter kontoplanen på nytt fra Tripletex (bare lesing). */
export async function POST(req: Request) {
  const u = await apiUser(req, true);
  if (u instanceof Response) return u;
  if (!canManage(u)) return json({ error: "Bare leder kan hente kontoplanen." }, 403);
  try {
    const c = await refreshAccounting(u.org_id!, u.id);
    await audit(u.email, "hentet kontoplan fra regnskap", `${c.accounts.length} kontoer`, u.org_id);
    return json(c);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Kunne ikke hente kontoplanen." }, e instanceof TripletexError ? 502 : 400);
  }
}
