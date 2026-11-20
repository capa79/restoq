"use server";
import { readFile as readFs } from "node:fs/promises";
import path from "node:path";
import { redirect } from "next/navigation";
import { audit, db } from "@/lib/db";
import { hashToken, requireAdmin, safeNext, sessionToken } from "@/lib/session";
import { EMAIL_RE, inviteUser } from "@/lib/users";
import { putDoc } from "@/lib/invoices";
import { hashPassword, tempPassword, TEMP_PASSWORD_DAYS } from "@/lib/password";
import { appUrl, mailEnabled, sendMail } from "@/lib/mail";

// Tilbake til samme fane/side med en melding
function go(form: FormData, msg: { ok?: string; feil?: string }, fallback = "/admin"): never {
  const to = safeNext(String(form.get("back") ?? ""), fallback);
  const q = msg.ok ? "ok=" + encodeURIComponent(msg.ok) : "feil=" + encodeURIComponent(msg.feil ?? "");
  redirect(to + (to.includes("?") ? "&" : "?") + q + String(form.get("hash") ?? ""));
}
const str = (form: FormData, k: string, max = 200) => String(form.get(k) ?? "").trim().slice(0, max);
const num = (form: FormData, k: string) => Number(form.get(k));

// ---------- kunder ----------
export async function createOrgAction(form: FormData) {
  const me = await requireAdmin();
  const name = str(form, "name", 120);
  const email = str(form, "email").toLowerCase();
  const owner = str(form, "owner", 80);
  const leadId = num(form, "lead");
  if (!name || !EMAIL_RE.test(email)) go(form, { feil: "Fyll inn navn på kunden og en gyldig e-post for leder." });
  const p = await db();
  const id = Number((await p.query("INSERT INTO orgs (name) VALUES ($1) RETURNING id", [name])).rows[0].id);
  let msg = "";
  try {
    const r = await inviteUser({ orgId: id, email, name: owner, role: "owner", by: me.email, orgName: name });
    msg = r.emailed ? `${name} er opprettet, og ${email} har fått e-post med innlogging.` : `${name} er opprettet. Midlertidig passord for ${email}: ${r.tempPassword} (gjelder i ${TEMP_PASSWORD_DAYS} dager).`;
  } catch (e) {
    await p.query("DELETE FROM orgs WHERE id = $1", [id]);
    go(form, { feil: e instanceof Error ? e.message : "Kunne ikke opprette kunden." });
  }
  if (Number.isSafeInteger(leadId) && leadId > 0) await p.query("UPDATE leads SET org_id = $2, handled = TRUE WHERE id = $1", [leadId, id]);
  await audit(me.email, "opprettet kunde", name, id);
  go(form, { ok: msg });
}

export async function updateOrgAction(form: FormData) {
  const me = await requireAdmin();
  const id = num(form, "org");
  const name = str(form, "name", 120);
  const note = str(form, "note", 2000);
  if (!name) go(form, { feil: "Kunden må ha et navn." });
  await (await db()).query("UPDATE orgs SET name = $2, note = $3 WHERE id = $1", [id, name, note]);
  await audit(me.email, "endret kunde", name, id);
  go(form, { ok: "Kunden er lagret." });
}

export async function openOrgAction(form: FormData) {
  await requireAdmin();
  const token = await sessionToken();
  await (await db()).query("UPDATE sessions SET acting_org_id = $2 WHERE token_hash = $1", [hashToken(token!), num(form, "org")]);
  redirect("/app");
}

export async function deleteOrgAction(form: FormData) {
  const me = await requireAdmin();
  const id = num(form, "org");
  const p = await db();
  const org = (await p.query("SELECT name FROM orgs WHERE id = $1", [id])).rows[0];
  if (!org || str(form, "confirm") !== org.name) go(form, { feil: "Skriv kundens navn nøyaktig for å slette." });
  await p.query("DELETE FROM users WHERE org_id = $1", [id]);
  await p.query("DELETE FROM orgs WHERE id = $1", [id]);
  await audit(me.email, "slettet kunde", org.name, id);
  redirect("/admin?fane=kunder&ok=" + encodeURIComponent(`${org.name} og alle dataene er slettet.`));
}

/** Pilotdata: About Contrasts' varer, leverandører og ukesalg (data/about-contrasts.json). */
export async function loadPilotAction(form: FormData) {
  const me = await requireAdmin();
  const id = num(form, "org");
  const d = JSON.parse(await readFs(path.join(process.cwd(), "data", "about-contrasts.json"), "utf8"));
  await putDoc(id, "config", "settings", d.settings, me.id);
  await putDoc(id, "config", "items", d.items, me.id);
  await audit(me.email, "lastet inn pilotdata", "About Contrasts", id);
  go(form, { ok: "Pilotdata er lastet inn (181 varer, 3 leverandører og ukesalg)." });
}

// ---------- brukere ----------
export async function addUserAction(form: FormData) {
  const me = await requireAdmin();
  const orgId = num(form, "org");
  const email = str(form, "email").toLowerCase();
  const name = str(form, "name", 80);
  const role = form.get("role") === "owner" ? "owner" : "staff";
  if (!EMAIL_RE.test(email)) go(form, { feil: "Skriv inn en gyldig e-postadresse." });
  const org = (await (await db()).query("SELECT name FROM orgs WHERE id = $1", [orgId])).rows[0];
  if (!org) go(form, { feil: "Velg en kunde." });
  try {
    const r = await inviteUser({ orgId, email, name, role, by: me.email, orgName: org.name });
    go(form, { ok: r.emailed ? `${email} er lagt til og har fått e-post.` : `${email} er lagt til. Midlertidig passord: ${r.tempPassword} (gjelder i ${TEMP_PASSWORD_DAYS} dager).` });
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e; // redirect
    go(form, { feil: e instanceof Error ? e.message : "Kunne ikke legge til brukeren." });
  }
}

async function target(form: FormData) {
  const id = num(form, "user");
  const u = (await (await db()).query("SELECT u.id, u.email, u.name, u.role, u.is_root, u.org_id, o.name AS org FROM users u LEFT JOIN orgs o ON o.id = u.org_id WHERE u.id = $1", [id])).rows[0];
  if (!u) go(form, { feil: "Fant ikke brukeren." });
  return u as { id: number; email: string; name: string; role: string; is_root: boolean; org_id: number | null; org: string | null };
}

export async function editUserAction(form: FormData) {
  const me = await requireAdmin();
  const u = await target(form);
  const name = str(form, "name", 80);
  const email = str(form, "email").toLowerCase();
  if (!EMAIL_RE.test(email)) go(form, { feil: "Ugyldig e-postadresse." });
  const p = await db();
  const taken = (await p.query("SELECT 1 FROM users WHERE lower(email) = $1 AND id <> $2", [email, u.id])).rowCount;
  if (taken) go(form, { feil: "E-postadressen er i bruk av en annen bruker." });
  let role = u.role;
  let orgId = u.org_id;
  if (u.role !== "admin") {
    role = form.get("role") === "owner" ? "owner" : "staff";
    const o = String(form.get("org") ?? "");
    orgId = /^\d+$/.test(o) ? Number(o) : null;
    if (u.role === "owner" && role !== "owner" && u.org_id) {
      const n = Number((await p.query("SELECT count(*)::int AS n FROM users WHERE org_id = $1 AND role = 'owner' AND id <> $2", [u.org_id, u.id])).rows[0].n);
      if (n === 0) go(form, { feil: "Kunden må ha minst én leder. Gjør en annen bruker til leder først." });
    }
  }
  await p.query("UPDATE users SET name = $2, email = $3, role = $4, org_id = $5, google_sub = CASE WHEN lower(email) = $3 THEN google_sub ELSE NULL END WHERE id = $1", [u.id, name, email, role, orgId]);
  await audit(me.email, "endret bruker", email, orgId);
  go(form, { ok: `${email} er lagret.` });
}

export async function resetPasswordAction(form: FormData) {
  const me = await requireAdmin();
  const u = await target(form);
  if (u.is_root) go(form, { feil: "Hovedadministratorens passord styres av ADMIN_PASSWORD i Render." });
  const pw = tempPassword();
  const p = await db();
  await p.query(`UPDATE users SET password_hash = $2, must_change_password = TRUE, temp_password_expires_at = now() + interval '${TEMP_PASSWORD_DAYS} days' WHERE id = $1`, [u.id, await hashPassword(pw)]);
  await p.query("DELETE FROM sessions WHERE user_id = $1", [u.id]);
  await audit(me.email, "nullstilte passord", u.email, u.org_id);
  const sent = await sendMail(u.email, "Nytt midlertidig passord til Restoq", `Hei${u.name ? " " + u.name : ""}!\n\nDu har fått et nytt midlertidig passord til Restoq${u.org ? ` (${u.org})` : ""}.\n\nLogg inn: ${appUrl()}/login\nE-post: ${u.email}\nMidlertidig passord: ${pw}\n\nPassordet gjelder i ${TEMP_PASSWORD_DAYS} dager, og du velger eget passord når du logger inn.\n\nHilsen Restoq`);
  go(form, { ok: sent ? `Nytt passord er sendt til ${u.email}.` : `Nytt midlertidig passord for ${u.email}: ${pw} (gjelder i ${TEMP_PASSWORD_DAYS} dager).` });
}

export async function logoutUserAction(form: FormData) {
  const me = await requireAdmin();
  const u = await target(form);
  const r = await (await db()).query("DELETE FROM sessions WHERE user_id = $1 AND user_id <> $2", [u.id, me.id]);
  await audit(me.email, "logget ut bruker", u.email, u.org_id);
  go(form, { ok: `${u.email} er logget ut fra ${r.rowCount} enhet(er).` });
}

export async function toggleDeveloperAction(form: FormData) {
  const me = await requireAdmin();
  const u = await target(form);
  const on = form.get("on") === "1";
  await (await db()).query("UPDATE users SET is_developer = $2 WHERE id = $1", [u.id, on]);
  await audit(me.email, on ? "ga utviklertilgang" : "fjernet utviklertilgang", u.email);
  go(form, { ok: on ? `${u.email} har fått utviklertilgang.` : `Utviklertilgangen til ${u.email} er fjernet.` });
}

export async function toggleAdminAction(form: FormData) {
  const me = await requireAdmin();
  const u = await target(form);
  const on = form.get("on") === "1";
  if (u.is_root) go(form, { feil: "Hovedadministratoren kan ikke endres her." });
  if (u.id === me.id) go(form, { feil: "Du kan ikke endre din egen administratorrolle." });
  if (on && u.org_id) go(form, { feil: "Administratorer kan ikke være knyttet til en kunde. Fjern kunden fra brukeren først." });
  const p = await db();
  await p.query("UPDATE users SET role = $2 WHERE id = $1", [u.id, on ? "admin" : "staff"]);
  await p.query("DELETE FROM sessions WHERE user_id = $1", [u.id]);
  await audit(me.email, on ? "gjorde til administrator" : "fjernet administratorrolle", u.email);
  go(form, { ok: on ? `${u.email} er nå administrator.` : `${u.email} er ikke lenger administrator.` });
}

export async function deleteUserAction(form: FormData) {
  const me = await requireAdmin();
  const u = await target(form);
  if (u.is_root || u.id === me.id) go(form, { feil: "Denne brukeren kan ikke slettes." });
  const p = await db();
  if (u.role === "owner" && u.org_id) {
    const n = Number((await p.query("SELECT count(*)::int AS n FROM users WHERE org_id = $1 AND role = 'owner' AND id <> $2", [u.org_id, u.id])).rows[0].n);
    if (n === 0) go(form, { feil: "Dette er kundens eneste leder. Gjør en annen bruker til leder først, eller slett kunden." });
  }
  await p.query("DELETE FROM users WHERE id = $1", [u.id]);
  await audit(me.email, "slettet bruker", u.email, u.org_id);
  go(form, { ok: `${u.email} er slettet.` });
}

/** Gir utviklertilgang med e-post. Finnes ikke brukeren, opprettes en utviklerkonto uten kunde. */
export async function developerAction(form: FormData) {
  const me = await requireAdmin();
  const email = str(form, "email").toLowerCase();
  const name = str(form, "name", 80);
  if (!EMAIL_RE.test(email)) go(form, { feil: "Skriv inn en gyldig e-postadresse." });
  const p = await db();
  const u = (await p.query("SELECT id FROM users WHERE lower(email) = $1", [email])).rows[0];
  if (u) {
    await p.query("UPDATE users SET is_developer = TRUE WHERE id = $1", [u.id]);
    await audit(me.email, "ga utviklertilgang", email);
    go(form, { ok: `${email} har fått utviklertilgang.` });
  }
  const pw = tempPassword();
  await p.query(
    `INSERT INTO users (email, name, role, is_developer, password_hash, must_change_password, temp_password_expires_at)
     VALUES ($1, $2, 'staff', TRUE, $3, TRUE, now() + interval '${TEMP_PASSWORD_DAYS} days')`,
    [email, name, await hashPassword(pw)]
  );
  await audit(me.email, "opprettet utviklerkonto", email);
  const sent = await sendMail(email, "Du har fått utviklertilgang til Restoq", `Hei${name ? " " + name : ""}!\n\nDu har fått tilgang til utviklersiden i Restoq, med tilbakemeldinger fra testerne og feilloggen.\n\nLogg inn: ${appUrl()}/login\nE-post: ${email}\nMidlertidig passord: ${pw}\n\nPassordet gjelder i ${TEMP_PASSWORD_DAYS} dager. Du velger eget passord første gang du logger inn.\n\nHilsen Restoq`);
  go(form, { ok: sent ? `Utviklerkonto opprettet. ${email} har fått e-post.` : `Utviklerkonto opprettet. Midlertidig passord for ${email}: ${pw} (gjelder i ${TEMP_PASSWORD_DAYS} dager).` });
}

// ---------- henvendelser ----------
export async function leadAction(form: FormData) {
  const me = await requireAdmin();
  const id = num(form, "id");
  const p = await db();
  if (form.get("op") === "delete") {
    await p.query("DELETE FROM leads WHERE id = $1", [id]);
    await audit(me.email, "slettet henvendelse", `#${id}`);
    go(form, { ok: "Henvendelsen er slettet." });
  }
  const handled = form.get("handled") === "1";
  await p.query("UPDATE leads SET handled = $2, note = $3 WHERE id = $1", [id, handled, str(form, "note", 2000)]);
  go(form, { ok: "Henvendelsen er lagret." });
}

export async function leadHandledAction(form: FormData) {
  await requireAdmin();
  await (await db()).query("UPDATE leads SET handled = NOT handled WHERE id = $1", [num(form, "id")]);
  go(form, { ok: "Lagret." });
}

// ---------- oppsett ----------
export async function testMailAction(form: FormData) {
  const me = await requireAdmin();
  if (!mailEnabled()) go(form, { feil: "E-post er ikke satt opp (RESEND_API_KEY og MAIL_FROM i Render)." });
  const to = str(form, "to").toLowerCase() || me.email;
  const ok = await sendMail(to, "Test fra Restoq", `Dette er en test fra adminsiden på ${appUrl()}.\n\nKommer denne fram, fungerer e-post fra Restoq.`);
  go(form, ok ? { ok: `Test-e-post sendt til ${to}.` } : { feil: "Resend avviste e-posten. Sjekk at domenet er bekreftet og at MAIL_FROM er riktig." });
}
