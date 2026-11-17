"use server";
import { redirect } from "next/navigation";
import { audit, db } from "@/lib/db";
import { sendMail } from "@/lib/mail";
import { clientIp } from "@/lib/session";
import { noteFail, tooManyFails } from "@/lib/rate-limit";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function leadAction(form: FormData) {
  if (String(form.get("website") ?? "")) redirect("/?takk=1#kontakt"); // honningkrukke mot roboter
  const ip = await clientIp();
  if (tooManyFails(`lead:${ip}`)) redirect("/?feil=mange#kontakt");
  const g = (k: string, max = 200) => String(form.get(k) ?? "").trim().slice(0, max);
  const name = g("name", 100), company = g("company", 120), email = g("email", 160).toLowerCase(), phone = g("phone", 40), venues = g("venues", 20), message = g("message", 2000);
  if (!name || !EMAIL_RE.test(email)) redirect("/?feil=mangler#kontakt");
  noteFail(`lead:${ip}`); // maks 8 henvendelser per IP per kvarter
  const p = await db();
  await p.query("INSERT INTO leads (name, company, email, phone, venues, message) VALUES ($1, $2, $3, $4, $5, $6)", [name, company, email, phone, venues, message]);
  await audit(email, "sendte henvendelse", company);
  const to = (process.env.LEADS_EMAIL ?? process.env.ADMIN_EMAIL ?? "").trim();
  if (to) await sendMail(to, `Ny henvendelse fra ${company || name} – Restoq`, `Navn: ${name}\nFirma: ${company}\nE-post: ${email}\nTelefon: ${phone}\nAntall steder: ${venues}\n\n${message}`);
  redirect("/?takk=1#kontakt");
}
