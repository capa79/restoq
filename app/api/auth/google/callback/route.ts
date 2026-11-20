import { NextRequest, NextResponse } from "next/server";
import { audit, db } from "@/lib/db";
import { GOOGLE_COOKIE, googleEnabled, googleIdentity } from "@/lib/google-auth";
import { clientIp, createSession, homeFor, safeNext } from "@/lib/session";
import { noteFail, tooManyFails } from "@/lib/rate-limit";

const to = (req: NextRequest, path: string) => {
  const res = NextResponse.redirect(new URL(path, req.url), 303);
  res.cookies.delete({ name: GOOGLE_COOKIE, path: "/api/auth/google" });
  return res;
};

export async function GET(req: NextRequest) {
  if (!googleEnabled()) return to(req, "/login?google=av");
  const ip = await clientIp();
  if (tooManyFails(`ip:${ip}`)) return to(req, "/login?feil=sperret");
  const sp = req.nextUrl.searchParams;
  if (sp.get("error")) return to(req, "/login?google=avbrutt");
  let saved: { state?: string; nonce?: string; verifier?: string; next?: string } = {};
  try {
    saved = JSON.parse(req.cookies.get(GOOGLE_COOKIE)?.value ?? "{}");
  } catch {}
  const code = sp.get("code");
  if (!code || !saved.state || sp.get("state") !== saved.state || !saved.nonce || !saved.verifier) return to(req, "/login?google=feil");
  let id = null;
  try {
    id = await googleIdentity(code, saved.verifier, saved.nonce);
  } catch (e) {
    console.error("Google-innlogging feilet", e);
  }
  if (!id) {
    noteFail(`ip:${ip}`);
    return to(req, "/login?google=feil");
  }
  const p = await db();
  // Først på Google-ID, ellers på bekreftet e-post (første gang)
  const { rows } = await p.query(
    `SELECT id, email, role, google_sub, is_developer, org_id FROM users
      WHERE google_sub = $1 OR (google_sub IS NULL AND lower(email) = $2)
      ORDER BY (google_sub = $1) DESC NULLS LAST LIMIT 1`,
    [id.sub, id.email]
  );
  const u = rows[0];
  if (!u) {
    noteFail(`ip:${ip}`);
    await audit(null, "Google-innlogging uten konto", id.email);
    return to(req, "/login?google=ingen-konto");
  }
  if (!u.google_sub) await p.query("UPDATE users SET google_sub = $2, must_change_password = FALSE WHERE id = $1", [u.id, id.sub]);
  await createSession(Number(u.id));
  await audit(u.email, "logget inn med Google");
  const next = safeNext(saved.next ?? "");
  return to(req, homeFor({ role: u.role, is_developer: u.is_developer, org_id: u.org_id == null ? null : Number(u.org_id) }, next));
}
