import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";

export const SESSION_COOKIE = "restoq_session";
export const SESSION_DAYS = 30;

export type Role = "admin" | "owner" | "staff";
export type CurrentUser = {
  id: number;
  email: string;
  name: string;
  role: Role;
  is_root: boolean;
  must_change_password: boolean;
  /** Kunden brukeren jobber i (for admin: kunden som er åpnet, ellers null) */
  org_id: number | null;
  org_name: string | null;
};

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export async function createSession(userId: number) {
  const token = randomBytes(32).toString("base64url");
  const p = await db();
  await p.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
    [hashToken(token), userId, String(SESSION_DAYS)]
  );
  await p.query("UPDATE users SET last_login_at = now() WHERE id = $1", [userId]);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const p = await db();
    await p.query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
  }
  jar.delete(SESSION_COOKIE);
}

export async function sessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const token = await sessionToken();
  if (!token) return null;
  const p = await db();
  const { rows } = await p.query(
    `SELECT u.id, u.email, u.name, u.role, u.is_root, u.must_change_password, s.last_seen_at,
            COALESCE(CASE WHEN u.role = 'admin' THEN s.acting_org_id ELSE u.org_id END, NULL) AS org_id,
            o.name AS org_name
       FROM sessions s JOIN users u ON u.id = s.user_id
       LEFT JOIN orgs o ON o.id = (CASE WHEN u.role = 'admin' THEN s.acting_org_id ELSE u.org_id END)
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  if (Date.now() - new Date(r.last_seen_at).getTime() > 10 * 60 * 1000) {
    p.query("UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1", [hashToken(token)]).catch(() => {});
  }
  return {
    id: Number(r.id),
    email: r.email,
    name: r.name,
    role: r.role,
    is_root: r.is_root,
    must_change_password: r.must_change_password,
    org_id: r.org_id == null ? null : Number(r.org_id),
    org_name: r.org_name ?? null,
  };
}

export async function requireUser(): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  if (u.must_change_password) redirect("/bytt-passord");
  return u;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const u = await requireUser();
  if (u.role !== "admin") redirect("/app");
  return u;
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "ukjent").trim();
}

export function safeNext(next: string | null | undefined, fallback = "/app"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}

/** Sjekker at et skjema/API-kall kommer fra vår egen side (vern mot CSRF) */
export async function sameOrigin(req: Request): Promise<boolean> {
  const origin = req.headers.get("origin");
  if (!origin) return req.method === "GET";
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
