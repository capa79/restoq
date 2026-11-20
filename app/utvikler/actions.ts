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
