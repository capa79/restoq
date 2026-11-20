"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { audit, db } from "@/lib/db";
import { requireDeveloper, safeNext } from "@/lib/session";
import { FEEDBACK_PRIORITIES, FEEDBACK_STATUSES } from "@/lib/feedback";

const back = (form: FormData, msg: string) => {
  const to = safeNext(String(form.get("back") ?? ""), "/utvikler");
  redirect(to + (to.includes("?") ? "&" : "?") + "ok=" + encodeURIComponent(msg) + String(form.get("hash") ?? ""));
};

export async function updateFeedbackAction(form: FormData) {
  const dev = await requireDeveloper();
  const id = Number(form.get("id"));
  const status = String(form.get("status") ?? "");
  const priority = String(form.get("priority") ?? "");
  const note = String(form.get("dev_note") ?? "").trim().slice(0, 4000);
  const assign = String(form.get("assigned") ?? "");
  if (!Number.isSafeInteger(id) || !FEEDBACK_STATUSES.some((s) => s.id === status) || !FEEDBACK_PRIORITIES.some((s) => s.id === priority)) back(form, "Ugyldige verdier.");
  const p = await db();
  let assigned: number | null = null;
  if (/^\d+$/.test(assign)) {
    const ok = await p.query("SELECT 1 FROM users WHERE id = $1 AND (is_developer OR role = 'admin')", [Number(assign)]);
    if (ok.rowCount) assigned = Number(assign);
  }
  const closed = status === "ferdig" || status === "avvist";
  await p.query(
    `UPDATE feedback SET status = $2, priority = $3, dev_note = $4, assigned_to = $5, updated_at = now(), updated_by = $6,
            handled_at = CASE WHEN $7 THEN COALESCE(handled_at, now()) ELSE NULL END WHERE id = $1`,
    [id, status, priority, note, assigned, dev.email, closed]
  );
  revalidatePath("/utvikler");
  back(form, `#${id} er lagret.`);
}

export async function deleteFeedbackAction(form: FormData) {
  const dev = await requireDeveloper();
  const id = Number(form.get("id"));
  await (await db()).query("DELETE FROM feedback WHERE id = $1", [id]);
  await audit(dev.email, "slettet tilbakemelding", `#${id}`);
  back(form, `#${id} er slettet.`);
}

export async function deleteErrorAction(form: FormData) {
  await requireDeveloper();
  await (await db()).query("DELETE FROM error_log WHERE id = $1", [Number(form.get("id"))]);
  back(form, "Markert som løst.");
}

export async function deleteSimilarErrorsAction(form: FormData) {
  await requireDeveloper();
  const msg = String(form.get("message") ?? "");
  const r = await (await db()).query("DELETE FROM error_log WHERE left(message, 140) = $1", [msg]);
  back(form, `${r.rowCount} like feil er markert som løst.`);
}

export async function clearErrorsAction(form: FormData) {
  const dev = await requireDeveloper();
  await (await db()).query("DELETE FROM error_log");
  await audit(dev.email, "tømte feilloggen");
  back(form, "Feilloggen er tømt.");
}

// ---- Oversettelser ----
import { isUiLang, OTHER_LANGS } from "@/lib/i18n";
import { aiTranslate, aiTranslateEnabled } from "@/lib/ai-translate";

export async function saveTranslationAction(form: FormData) {
  const dev = await requireDeveloper();
  const lang = String(form.get("lang") ?? "");
  const source = String(form.get("source") ?? "").slice(0, 400);
  const text = String(form.get("text") ?? "").replace(/\s+/g, " ").trim().slice(0, 600);
  if (!isUiLang(lang) || lang === "nb" || !source) back(form, "Ugyldig.");
  const p = await db();
  if (text) {
    await p.query(
      `INSERT INTO i18n_overrides (lang, source, text, updated_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (lang, source) DO UPDATE SET text = EXCLUDED.text, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [lang, source, text, dev.email]
    );
    await p.query("DELETE FROM i18n_missing WHERE lang = $1 AND source = $2", [lang, source]);
  } else await p.query("DELETE FROM i18n_overrides WHERE lang = $1 AND source = $2", [lang, source]);
  back(form, text ? "Oversettelsen er lagret." : "Rettelsen er fjernet.");
}

export async function ignoreMissingAction(form: FormData) {
  await requireDeveloper();
  const lang = String(form.get("lang") ?? "");
  const source = String(form.get("source") ?? "");
  const p = await db();
  if (form.get("all") === "1") await p.query("DELETE FROM i18n_missing WHERE lang = $1", [lang]);
  else await p.query("DELETE FROM i18n_missing WHERE lang = $1 AND source = $2", [lang, source]);
  back(form, "Fjernet fra lista.");
}

export async function aiTranslateMissingAction(form: FormData) {
  const dev = await requireDeveloper();
  if (!aiTranslateEnabled()) back(form, "Automatisk oversettelse er ikke satt opp (ANTHROPIC_API_KEY mangler i Render).");
  const p = await db();
  let n = 0;
  for (const l of OTHER_LANGS) {
    const rows = (await p.query("SELECT source FROM i18n_missing WHERE lang = $1 ORDER BY hits DESC LIMIT 300", [l.id])).rows.map((r) => r.source as string);
    if (!rows.length) continue;
    const got = await aiTranslate(l.id, rows).catch(() => ({} as Record<string, string>));
    for (const [source, text] of Object.entries(got)) {
      await p.query(
        `INSERT INTO i18n_overrides (lang, source, text, updated_by) VALUES ($1, $2, $3, 'Claude')
         ON CONFLICT (lang, source) DO NOTHING`,
        [l.id, source, text]
      );
      await p.query("DELETE FROM i18n_missing WHERE lang = $1 AND source = $2", [l.id, source]);
      n++;
    }
  }
  await audit(dev.email, "oversatte manglende tekster med Claude", String(n));
  back(form, `${n} tekster er oversatt. Sjekk dem gjerne under «Rettelser».`);
}
