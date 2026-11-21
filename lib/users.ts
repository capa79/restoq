import { audit, db } from "./db";
import { hashPassword, tempPassword, TEMP_PASSWORD_DAYS } from "./password";
import { appUrl, sendMail } from "./mail";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Oppretter (eller nullstiller) en bruker med midlertidig passord. Returnerer passordet hvis e-post ikke ble sendt. */
export async function inviteUser(opts: { orgId: number; email: string; name: string; role: "owner" | "staff"; by: string; orgName: string }) {
  const p = await db();
  const pw = tempPassword();
  const hash = await hashPassword(pw);
  const email = opts.email.trim().toLowerCase();
  const existing = (await p.query("SELECT id, org_id, role FROM users WHERE lower(email) = $1", [email])).rows[0];
  if (existing && (existing.role === "admin" || Number(existing.org_id) !== opts.orgId)) throw new Error("E-postadressen er allerede i bruk hos en annen kunde.");
  if (existing) {
    await p.query(
      `UPDATE users SET name = $2, role = $3, password_hash = $4, must_change_password = TRUE, temp_password_expires_at = now() + interval '${TEMP_PASSWORD_DAYS} days' WHERE id = $1`,
      [existing.id, opts.name, opts.role, hash]
    );
    await p.query("DELETE FROM sessions WHERE user_id = $1", [existing.id]);
  } else {
    await p.query(
      `INSERT INTO users (org_id, email, name, role, password_hash, must_change_password, temp_password_expires_at)
       VALUES ($1, $2, $3, $4, $5, TRUE, now() + interval '${TEMP_PASSWORD_DAYS} days')`,
      [opts.orgId, email, opts.name, opts.role, hash]
    );
  }
  const slug = (await p.query("SELECT slug FROM orgs WHERE id = $1", [opts.orgId])).rows[0]?.slug as string | undefined;
  const loginUrl = slug ? `${appUrl()}/v/${slug}` : `${appUrl()}/login`;
  await audit(opts.by, existing ? "nullstilte passord" : "la til bruker", email, opts.orgId);
  const sent = await sendMail(
    email,
    `Du har fått tilgang til Restoq – ${opts.orgName}`,
    `Hei${opts.name ? " " + opts.name : ""}!\n\nDu har fått tilgang til lager- og bestillingsappen for ${opts.orgName}.\n\nLogg inn her: ${loginUrl}\nE-post: ${email}\nMidlertidig passord: ${pw}\n\nPassordet gjelder i ${TEMP_PASSWORD_DAYS} dager. Du velger eget passord første gang du logger inn. Har du Google-konto på samme e-post, kan du også bruke «Logg inn med Google».${slug ? "\n\nTips: Legg siden til på hjemskjermen på mobilen, så får du appen som et eget ikon." : ""}\n\nHilsen Restoq`
  );
  return { tempPassword: sent ? null : pw, emailed: sent };
}

/**
 * Administrator setter et passord for en bruker. Passordet logges aldri.
 * mustChange = true: brukeren må velge eget passord ved neste innlogging (gjelder da i TEMP_PASSWORD_DAYS dager).
 * Brukeren logges ut på alle enheter.
 */
export async function setUserPassword(userId: number, pw: string, mustChange: boolean) {
  const p = await db();
  await p.query(
    `UPDATE users SET password_hash = $2, must_change_password = $3,
       temp_password_expires_at = CASE WHEN $3 THEN now() + interval '${TEMP_PASSWORD_DAYS} days' ELSE NULL END
     WHERE id = $1`,
    [userId, await hashPassword(pw), mustChange],
  );
  await p.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
}
