"use server";
import { redirect } from "next/navigation";
import { audit, db } from "@/lib/db";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/password";
import { clearFails, noteFail, tooManyFails } from "@/lib/rate-limit";
import { clientIp, createSession, destroySession, getCurrentUser, safeNext } from "@/lib/session";

export async function loginAction(form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const pw = String(form.get("password") ?? "");
  const next = safeNext(String(form.get("next") ?? ""));
  const ip = await clientIp();
  const back = (err: string) => redirect(`/login?feil=${err}&next=${encodeURIComponent(next)}&e=${encodeURIComponent(email)}`);
  if (tooManyFails(`ip:${ip}`, `e:${email}`)) back("sperret");
  if (!email || !pw) back("mangler");
  const p = await db();
  const { rows } = await p.query(
    "SELECT id, password_hash, must_change_password, temp_password_expires_at, role FROM users WHERE lower(email) = $1",
    [email]
  );
  const u = rows[0];
  const ok = u?.password_hash ? await verifyPassword(pw, u.password_hash) : false;
  if (!ok) {
    noteFail(`ip:${ip}`, `e:${email}`);
    await audit(email, "mislykket innlogging");
    back("feil");
  }
  if (u.must_change_password && u.temp_password_expires_at && new Date(u.temp_password_expires_at) < new Date()) back("utlopt");
  clearFails(`e:${email}`);
  await createSession(Number(u.id));
  await audit(email, "logget inn");
  if (u.must_change_password) redirect("/bytt-passord");
  redirect(u.role === "admin" && next === "/app" ? "/admin" : next);
}

export async function changePasswordAction(form: FormData) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const pw = String(form.get("password") ?? "");
  const pw2 = String(form.get("password2") ?? "");
  const problem = passwordProblem(pw);
  if (problem) redirect(`/bytt-passord?feil=${encodeURIComponent(problem)}`);
  if (pw !== pw2) redirect(`/bytt-passord?feil=${encodeURIComponent("Passordene er ikke like.")}`);
  const p = await db();
  await p.query("UPDATE users SET password_hash = $2, must_change_password = FALSE, temp_password_expires_at = NULL WHERE id = $1", [me.id, await hashPassword(pw)]);
  await audit(me.email, "valgte nytt passord", "", me.org_id);
  redirect(me.role === "admin" ? "/admin" : "/app");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login?ut=1");
}
