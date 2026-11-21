// Bekreftelse med passord før Restoq endrer noe i et annet system (Tripletex, Planday …).
// Klienten sender { password } med forespørselen. Mangler det eller er feil, svarer serveren 428
// med needPassword: true, og appen spør etter passordet og prøver igjen.
import { audit, db } from "./db";
import { verifyPassword } from "./password";
import { json } from "./api-auth";

const MAX_FAILS = 5; // per 15 minutter per bruker

export async function requirePassword(user: { id: number; email: string; org_id: number | null }, password: unknown, what: string): Promise<Response | null> {
  const pw = typeof password === "string" ? password : "";
  if (!pw) return json({ error: `Bekreft med passordet ditt før ${what}.`, needPassword: true, what }, 428);
  const p = await db();
  const fails = Number((await p.query("SELECT count(*)::int AS n FROM audit WHERE actor = $1 AND action = 'feil passord ved bekreftelse' AND created_at > now() - interval '15 minutes'", [user.email])).rows[0].n);
  if (fails >= MAX_FAILS) return json({ error: "For mange feil forsøk. Vent 15 minutter og prøv igjen.", needPassword: true, locked: true, what }, 429);
  const r = (await p.query("SELECT password_hash FROM users WHERE id = $1", [user.id])).rows[0];
  const ok = !!r?.password_hash && (await verifyPassword(pw, r.password_hash).catch(() => false));
  if (!ok) {
    await audit(user.email, "feil passord ved bekreftelse", what, user.org_id);
    return json({ error: "Feil passord. Prøv igjen.", needPassword: true, what }, 428);
  }
  await audit(user.email, "bekreftet med passord", what, user.org_id);
  return null;
}
