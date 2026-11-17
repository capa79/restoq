import { audit } from "@/lib/db";
import { apiUser, canManage, json } from "@/lib/api-auth";
import { connectTripletex, disconnectTripletex, tripletexStatus } from "@/lib/tripletex";

export async function GET(req: Request) {
  const u = await apiUser(req);
  if (u instanceof Response) return u;
  return json(await tripletexStatus(u.org_id!));
}
export async function POST(req: Request) {
  const u = await apiUser(req, true);
  if (u instanceof Response) return u;
  if (!canManage(u)) return json({ error: "Bare leder kan koble til Tripletex." }, 403);
  const b = await req.json().catch(() => ({}));
  const token = String(b.employeeToken ?? "").trim();
  if (token.length < 10) return json({ error: "Lim inn API-nøkkelen (employee token) fra Tripletex." }, 400);
  try {
    await connectTripletex(u.org_id!, token);
    await audit(u.email, "koblet til Tripletex", "", u.org_id);
    return json(await tripletexStatus(u.org_id!));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Kunne ikke koble til." }, 400);
  }
}
export async function DELETE(req: Request) {
  const u = await apiUser(req, true);
  if (u instanceof Response) return u;
  if (!canManage(u)) return json({ error: "Bare leder kan koble fra." }, 403);
  await disconnectTripletex(u.org_id!);
  await audit(u.email, "koblet fra Tripletex", "", u.org_id);
  return json({ ok: true });
}
