import { db } from "@/lib/db";
import { appUrl, sendMail } from "@/lib/mail";
import { FEEDBACK_KINDS, imageType, kindLabel } from "@/lib/feedback";
import { getCurrentUser, sameOrigin } from "@/lib/session";
import { json } from "@/lib/api-auth";

const MAX_IMAGES = 3;
const MAX_BYTES = 3 * 1024 * 1024;

// «Gi tilbakemelding» i appen: tekst, valgfrie skjermbilder og automatisk kontekst (side, nettleser, siste feil).
export async function POST(req: Request) {
  if (!(await sameOrigin(req))) return json({ error: "Ugyldig opphav." }, 403);
  const u = await getCurrentUser();
  if (!u) return json({ error: "Du er logget ut. Logg inn på nytt." }, 401);
  const form = await req.formData().catch(() => null);
  if (!form) return json({ error: "Ugyldig skjema." }, 400);
  const kind = String(form.get("kind") ?? "annet");
  const message = String(form.get("message") ?? "").trim().slice(0, 4000);
  const path = String(form.get("path") ?? "").slice(0, 300);
  const context = String(form.get("context") ?? "").slice(0, 6000);
  if (!FEEDBACK_KINDS.some((k) => k.id === kind)) return json({ error: "Velg hva tilbakemeldingen gjelder." }, 400);
  if (message.length < 3) return json({ error: "Skriv litt om hva du vil si fra om." }, 400);
  const files = form.getAll("image").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f && f.size > 0);
  if (files.length > MAX_IMAGES) return json({ error: `Du kan legge ved høyst ${MAX_IMAGES} bilder.` }, 400);
  const images: { mime: string; data: Buffer }[] = [];
  for (const f of files) {
    if (f.size > MAX_BYTES) return json({ error: "Et av bildene er for stort (maks 3 MB)." }, 400);
    const data = Buffer.from(await f.arrayBuffer());
    const mime = imageType(data);
    if (!mime) return json({ error: "Bare bilder i PNG-, JPEG- eller WebP-format kan legges ved." }, 400);
    images.push({ mime, data });
  }
  const p = await db();
  const recent = await p.query("SELECT count(*)::int AS n FROM feedback WHERE user_id = $1 AND created_at > now() - interval '1 hour'", [u.id]);
  if (recent.rows[0].n >= 20) return json({ error: "Du har sendt mange tilbakemeldinger den siste timen. Prøv igjen litt senere." }, 429);
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 300);
  const version = (process.env.RENDER_GIT_COMMIT ?? "").slice(0, 7);
  const id = Number((await p.query(
    "INSERT INTO feedback (org_id, user_id, kind, message, path, context, user_agent, version) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
    [u.org_id, u.id, kind, message, path, context, ua, version]
  )).rows[0].id);
  for (const img of images) await p.query("INSERT INTO feedback_images (feedback_id, mime, data) VALUES ($1, $2, $3)", [id, img.mime, img.data]);
  // Varsle utviklerne om feil (ikke om ros og forslag)
  if (kind === "feil" || kind === "tall") {
    const devs = (await p.query("SELECT email FROM users WHERE is_developer OR role = 'admin'")).rows.map((r) => r.email as string);
    const text = `${kindLabel(kind)} fra ${u.name || "en tester"}${u.org_name ? ` (${u.org_name})` : ""}:\n\n${message}\n\nSide: ${path || "–"}${images.length ? `\n${images.length} bilde(r) lagt ved.` : ""}\n\nÅpne: ${appUrl()}/utvikler#fb-${id}`;
    for (const to of devs) await sendMail(to, `Restoq #${id}: ${kindLabel(kind)}`, text);
  }
  return json({ ok: true, id });
}
