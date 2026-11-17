import { db } from "@/lib/db";
import { apiUser, canManage, json } from "@/lib/api-auth";
import { EMAIL_RE, inviteUser } from "@/lib/users";

export async function GET(req: Request) {
  const u = await apiUser(req);
  if (u instanceof Response) return u;
  if (!canManage(u)) return json({ error: "Bare leder kan se brukerne." }, 403);
  const p = await db();
  const { rows } = await p.query(
    "SELECT id, email, name, role, must_change_password, last_login_at, (google_sub IS NOT NULL) AS google FROM users WHERE org_id = $1 ORDER BY role, name, email",
    [u.org_id]
  );
  return json({ users: rows.map((r) => ({ ...r, id: Number(r.id), me: Number(r.id) === u.id })) });
}

export async function POST(req: Request) {
  const u = await apiUser(req, true);
  if (u instanceof Response) return u;
  if (!canManage(u)) return json({ error: "Bare leder kan legge til brukere." }, 403);
  const b = await req.json().catch(() => ({}));
  const email = String(b.email ?? "").trim().toLowerCase();
  const name = String(b.name ?? "").trim().slice(0, 80);
  const role = b.role === "owner" ? "owner" : "staff";
  if (!EMAIL_RE.test(email)) return json({ error: "Skriv inn en gyldig e-postadresse." }, 400);
  try {
    const r = await inviteUser({ orgId: u.org_id!, email, name, role, by: u.email, orgName: u.org_name ?? "" });
    return json({ ok: true, ...r });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Kunne ikke legge til brukeren." }, 400);
  }
}
