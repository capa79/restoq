"use server";
import { readFile as readFs } from "node:fs/promises";
import path from "node:path";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { audit, db } from "@/lib/db";
import { hashToken, requireAdmin, sessionToken } from "@/lib/session";
import { EMAIL_RE, inviteUser } from "@/lib/users";
import { putDoc } from "@/lib/invoices";

export async function createOrgAction(form: FormData) {
  const me = await requireAdmin();
  const name = String(form.get("name") ?? "").trim().slice(0, 120);
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const owner = String(form.get("owner") ?? "").trim().slice(0, 80);
  if (!name || !EMAIL_RE.test(email)) redirect("/admin?feil=" + encodeURIComponent("Fyll inn navn på kunden og en gyldig e-post for leder."));
  const p = await db();
  const id = Number((await p.query("INSERT INTO orgs (name) VALUES ($1) RETURNING id", [name])).rows[0].id);
  let msg = "";
  try {
    const r = await inviteUser({ orgId: id, email, name: owner, role: "owner", by: me.email, orgName: name });
    msg = r.emailed ? `Kunden er opprettet, og ${email} har fått e-post med innlogging.` : `Kunden er opprettet. Midlertidig passord for ${email}: ${r.tempPassword} (gjelder i 7 dager).`;
  } catch (e) {
    await p.query("DELETE FROM orgs WHERE id = $1", [id]);
    redirect("/admin?feil=" + encodeURIComponent(e instanceof Error ? e.message : "Feil"));
  }
  await audit(me.email, "opprettet kunde", name, id);
  redirect("/admin?ok=" + encodeURIComponent(msg));
}

export async function openOrgAction(form: FormData) {
  await requireAdmin();
  const id = Number(form.get("org"));
  const token = await sessionToken();
  const p = await db();
  await p.query("UPDATE sessions SET acting_org_id = $2 WHERE token_hash = $1", [hashToken(token!), id]);
  redirect("/app");
}

export async function deleteOrgAction(form: FormData) {
  const me = await requireAdmin();
  const id = Number(form.get("org"));
  const confirm = String(form.get("confirm") ?? "");
  const p = await db();
  const org = (await p.query("SELECT name FROM orgs WHERE id = $1", [id])).rows[0];
  if (!org || confirm !== org.name) redirect("/admin?feil=" + encodeURIComponent("Skriv kundens navn nøyaktig for å slette."));
  await p.query("DELETE FROM orgs WHERE id = $1", [id]);
  await audit(me.email, "slettet kunde", org.name, id);
  redirect("/admin?ok=" + encodeURIComponent(`${org.name} er slettet.`));
}

/** Pilotdata: About Contrasts' varer, leverandører og ukesalg (data/about-contrasts.json). */
export async function loadPilotAction(form: FormData) {
  const me = await requireAdmin();
  const id = Number(form.get("org"));
  const d = JSON.parse(await readFs(path.join(process.cwd(), "data", "about-contrasts.json"), "utf8"));
  await putDoc(id, "config", "settings", d.settings, me.id);
  await putDoc(id, "config", "items", d.items, me.id);
  await audit(me.email, "lastet inn pilotdata", "About Contrasts", id);
  redirect("/admin?ok=" + encodeURIComponent("Pilotdata er lastet inn (varer, leverandører og ukesalg)."));
}

export async function leadHandledAction(form: FormData) {
  await requireAdmin();
  const p = await db();
  await p.query("UPDATE leads SET handled = NOT handled WHERE id = $1", [Number(form.get("id"))]);
  revalidatePath("/admin");
}

/** Gir eller fjerner utviklertilgang. Finnes ikke brukeren, opprettes en utviklerkonto uten kunde. */
export async function developerAction(form: FormData) {
  const me = await requireAdmin();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const name = String(form.get("name") ?? "").trim().slice(0, 80);
  const on = String(form.get("on") ?? "1") === "1";
  if (!EMAIL_RE.test(email)) redirect("/admin?feil=" + encodeURIComponent("Skriv inn en gyldig e-postadresse."));
  const p = await db();
  const u = (await p.query("SELECT id, role FROM users WHERE lower(email) = $1", [email])).rows[0];
  if (u) {
    await p.query("UPDATE users SET is_developer = $2 WHERE id = $1", [u.id, on]);
    await audit(me.email, on ? "ga utviklertilgang" : "fjernet utviklertilgang", email);
    redirect("/admin?ok=" + encodeURIComponent(on ? `${email} har fått utviklertilgang.` : `Utviklertilgangen til ${email} er fjernet.`) + "#utviklere");
  }
  if (!on) redirect("/admin#utviklere");
  const { hashPassword, tempPassword, TEMP_PASSWORD_DAYS } = await import("@/lib/password");
  const { sendMail, appUrl } = await import("@/lib/mail");
  const pw = tempPassword();
  await p.query(
    `INSERT INTO users (email, name, role, is_developer, password_hash, must_change_password, temp_password_expires_at)
     VALUES ($1, $2, 'staff', TRUE, $3, TRUE, now() + interval '${TEMP_PASSWORD_DAYS} days')`,
    [email, name, await hashPassword(pw)]
  );
  await audit(me.email, "opprettet utviklerkonto", email);
  const sent = await sendMail(email, "Du har fått utviklertilgang til Restoq", `Hei${name ? " " + name : ""}!\n\nDu har fått tilgang til utviklersiden i Restoq, med tilbakemeldinger fra testerne og feilloggen.\n\nLogg inn: ${appUrl()}/login\nE-post: ${email}\nMidlertidig passord: ${pw}\n\nPassordet gjelder i ${TEMP_PASSWORD_DAYS} dager. Du velger eget passord første gang du logger inn.\n\nHilsen Restoq`);
  redirect("/admin?ok=" + encodeURIComponent(sent ? `Utviklerkonto opprettet. ${email} har fått e-post.` : `Utviklerkonto opprettet. Midlertidig passord for ${email}: ${pw} (gjelder i ${TEMP_PASSWORD_DAYS} dager).`) + "#utviklere");
}
