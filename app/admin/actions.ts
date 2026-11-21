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
import { buildBrand, dataUrlBuffer, getBrand, logoDataUrl, normalizeUrl, saveHero, uniqueSlug } from "@/lib/brand";

// Tilbake til samme fane/side med en melding
function go(form: FormData, msg: { ok?: string; feil?: string }, fallback = "/admin"): never {
  const to = safeNext(String(form.get("back") ?? ""), fallback);
  const q = msg.ok ? "ok=" + encodeURIComponent(msg.ok) : "feil=" + encodeURIComponent(msg.feil ?? "");
  redirect(to + (to.includes("?") ? "&" : "?") + q + String(form.get("hash") ?? ""));
}
const str = (form: FormData, k: string, max = 200) => String(form.get(k) ?? "").trim().slice(0, max);
const num = (form: FormData, k: string) => Number(form.get(k));

// ---------- kunder ----------
const ROLE_WORDS: Record<string, "owner" | "staff"> = { administrator: "owner", admin: "owner", leder: "owner", owner: "owner", sjef: "owner", ansatt: "staff", staff: "staff" };
/** «e-post, navn, rolle» per linje (rolle: administrator/ansatt, standard ansatt). */
function parseUsers(text: string) {
  const out: { email: string; name: string; role: "owner" | "staff" }[] = []; const bad: string[] = [];
  for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 50)) {
    const parts = line.split(/[,;\t]/).map((x) => x.trim());
    const email = (parts.find((x) => EMAIL_RE.test(x)) ?? "").toLowerCase();
    if (!email) { bad.push(line); continue; }
    const rest = parts.filter((x) => x.toLowerCase() !== email);
    const roleIdx = rest.findIndex((x) => ROLE_WORDS[x.toLowerCase()]);
    const role = roleIdx >= 0 ? ROLE_WORDS[rest[roleIdx].toLowerCase()] : "staff";
    out.push({ email, name: rest.filter((_, i) => i !== roleIdx).join(" ").slice(0, 80), role });
  }
  return { users: out, bad };
}
async function fileBuf(form: FormData, k: string): Promise<Buffer | null> {
  const f = form.get(k);
  if (!f || typeof f === "string" || !(f as File).size) return null;
  if ((f as File).size > 5 * 1024 * 1024) throw new Error("Logoen er større enn 5 MB.");
  return Buffer.from(await (f as File).arrayBuffer());
}

/** Onboarding: kunde, brukere, logo og hjemmeside. Whitelabel-siden lages fra logo og hjemmeside. */
export async function createOrgAction(form: FormData) {
  const me = await requireAdmin();
  const name = str(form, "name", 120);
  const email = str(form, "email").toLowerCase();
  const owner = str(form, "owner", 80);
  const leadId = num(form, "lead");
  const websiteRaw = str(form, "website", 300);
  const website = websiteRaw ? normalizeUrl(websiteRaw) : null;
  const consent = form.get("consent") === "1";
  if (!name || !EMAIL_RE.test(email)) go(form, { feil: "Fyll inn navn på stedet og en gyldig e-post for leder." });
  if (websiteRaw && !website) go(form, { feil: "Hjemmesiden ser ikke ut som en gyldig adresse (f.eks. aboutcontrasts.no)." });
  let logo: Buffer | null = null;
  try { logo = await fileBuf(form, "logo"); } catch (e) { go(form, { feil: (e as Error).message }); }
  const extra = parseUsers(str(form, "users", 5000));
  const p = await db();
  const slug = await uniqueSlug(str(form, "slug", 40) || name);
  const id = Number((await p.query("INSERT INTO orgs (name, slug, website, orgnr) VALUES ($1, $2, $3, $4) RETURNING id", [name, slug, website ?? "", str(form, "orgnr", 20).replace(/\s/g, "")])).rows[0].id);
  const lines: string[] = [];
  try {
    const r = await inviteUser({ orgId: id, email, name: owner, role: "owner", by: me.email, orgName: name });
    lines.push(r.emailed ? `${email} (administrator) har fått e-post.` : `${email} (administrator): ${r.tempPassword}`);
  } catch (e) {
    await p.query("DELETE FROM orgs WHERE id = $1", [id]);
    go(form, { feil: e instanceof Error ? e.message : "Kunne ikke opprette kunden." });
  }
  for (const u of extra.users.filter((u) => u.email !== email)) {
    try { const r = await inviteUser({ orgId: id, ...u, by: me.email, orgName: name }); lines.push(r.emailed ? `${u.email} har fått e-post.` : `${u.email}: ${r.tempPassword}`); }
    catch (e) { lines.push(`${u.email}: ${e instanceof Error ? e.message : "feil"}`); }
  }
  const built = await buildBrand({ name, website, logo, useSiteImages: consent });
  await putDoc(id, "config", "brand", { ...built.brand, hero: built.hero ? Date.now() : undefined }, me.id);
  await saveHero(id, built.hero);
  if (Number.isSafeInteger(leadId) && leadId > 0) await p.query("UPDATE leads SET org_id = $2, handled = TRUE WHERE id = $1", [leadId, id]);
  await audit(me.email, "opprettet kunde", name, id);
  const pw = lines.some((l) => !l.endsWith("e-post.")) ? ` Midlertidige passord (gjelder i ${TEMP_PASSWORD_DAYS} dager): ${lines.join(" · ")}` : ` ${lines.join(" ")}`;
  const warn = [...built.notes, ...(extra.bad.length ? [`Disse linjene ble hoppet over: ${extra.bad.join(" | ")}`] : [])].join(" ");
  redirect(`/admin?fane=kunder&kunde=${id}&ok=${encodeURIComponent(`${name} er opprettet med egen side på /v/${slug}.${pw}${warn ? " Merk: " + warn : ""}`)}#utseende`);
}

/** Lagrer utseendet manuelt (farger, tekst, adresse, ny logo). */
export async function saveBrandAction(form: FormData) {
  const me = await requireAdmin();
  const id = num(form, "org");
  const p = await db();
  const org = (await p.query("SELECT name FROM orgs WHERE id = $1", [id])).rows[0];
  if (!org) go(form, { feil: "Fant ikke kunden." });
  const cur = await getBrand(id);
  const color = (k: string, fb: string) => { const v = str(form, k, 7); return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fb; };
  const next = { ...cur, head: color("head", cur.head), accent: color("accent", cur.accent), tagline: str(form, "tagline", 220), name: str(form, "display", 80) || org.name };
  try { const b = await fileBuf(form, "logo"); if (b) next.logo = await logoDataUrl(b); } catch (e) { go(form, { feil: `Logoen kunne ikke brukes: ${(e as Error).message}` }); }
  if (form.get("removeLogo") === "1") next.logo = null;
  if (form.get("removeHero") === "1") { await saveHero(id, null); delete next.hero; }
  const slugIn = str(form, "slug", 40);
  if (slugIn) await p.query("UPDATE orgs SET slug = $2 WHERE id = $1", [id, await uniqueSlug(slugIn, id)]);
  await putDoc(id, "config", "brand", next, me.id);
  await audit(me.email, "endret utseende", org.name, id);
  go(form, { ok: "Utseendet er lagret. Appen og stedets side er oppdatert." });
}

/** Henter logo, farger, tekst og bilde på nytt fra hjemmesiden. */
export async function refreshBrandAction(form: FormData) {
  const me = await requireAdmin();
  const id = num(form, "org");
  const p = await db();
  const org = (await p.query("SELECT name, website FROM orgs WHERE id = $1", [id])).rows[0];
  if (!org) go(form, { feil: "Fant ikke kunden." });
  const websiteRaw = str(form, "website", 300) || org.website;
  const website = normalizeUrl(websiteRaw);
  if (!website) go(form, { feil: "Legg inn en gyldig hjemmeside først." });
  let logo: Buffer | null = null;
  try { logo = await fileBuf(form, "logo"); } catch (e) { go(form, { feil: (e as Error).message }); }
  const cur = await getBrand(id);
  const keepLogo = form.get("keepLogo") === "1" && cur.logo;
  const built = await buildBrand({ name: org.name, website, logo: logo ?? (keepLogo ? dataUrlBuffer(cur.logo!) : null), useSiteImages: form.get("consent") === "1" });
  await p.query("UPDATE orgs SET website = $2 WHERE id = $1", [id, website]);
  await putDoc(id, "config", "brand", { ...built.brand, name: cur.name ?? org.name, hero: built.hero ? Date.now() : undefined }, me.id);
  await saveHero(id, built.hero);
  await audit(me.email, "hentet utseende fra hjemmesiden", website, id);
  go(form, built.notes.length ? { ok: "Oppdatert, men merk: " + built.notes.join(" ") } : { ok: "Logo, farger, tekst og bilde er hentet fra hjemmesiden." });
}

export async function updateOrgAction(form: FormData) {
  const me = await requireAdmin();
  const id = num(form, "org");
  const name = str(form, "name", 120);
  const note = str(form, "note", 2000);
  if (!name) go(form, { feil: "Kunden må ha et navn." });
  await (await db()).query("UPDATE orgs SET name = $2, note = $3, orgnr = $4 WHERE id = $1", [id, name, note, str(form, "orgnr", 20).replace(/\s/g, "")]);
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
      if (n === 0) go(form, { feil: "Kunden må ha minst én administrator. Gjør en annen bruker til administrator først." });
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
    if (n === 0) go(form, { feil: "Dette er kundens eneste administrator. Gjør en annen bruker til administrator først, eller slett kunden." });
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
