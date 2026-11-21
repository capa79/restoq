import { audit } from "@/lib/db";
import { apiUser, canManage, json } from "@/lib/api-auth";
import { connectPlanday, disconnectPlanday, plandayStatus, setPlandayDepartments, syncPlanday } from "@/lib/planday";

export async function GET(req: Request) {
  const u = await apiUser(req);
  if (u instanceof Response) return u;
  return json(await plandayStatus(u.org_id!));
}
export async function POST(req: Request) {
  const u = await apiUser(req, true);
  if (u instanceof Response) return u;
  if (!canManage(u)) return json({ error: "Bare administrator kan koble til Planday." }, 403);
  const b = await req.json().catch(() => ({}));
  try {
    if (Array.isArray(b.departmentIds)) {
      await setPlandayDepartments(u.org_id!, b.departmentIds.map(Number).filter(Number.isFinite));
    } else {
      const token = String(b.token ?? "").trim();
      if (token.length < 10) return json({ error: "Lim inn tokenet fra Planday." }, 400);
      await connectPlanday(u.org_id!, token);
      await audit(u.email, "koblet til Planday", "", u.org_id);
      await syncPlanday(u.org_id!, u.id).catch(() => null);
    }
    return json(await plandayStatus(u.org_id!));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Kunne ikke koble til Planday." }, 400);
  }
}
export async function DELETE(req: Request) {
  const u = await apiUser(req, true);
  if (u instanceof Response) return u;
  if (!canManage(u)) return json({ error: "Bare administrator kan koble fra." }, 403);
  await disconnectPlanday(u.org_id!);
  await audit(u.email, "koblet fra Planday", "", u.org_id);
  return json({ ok: true });
}
