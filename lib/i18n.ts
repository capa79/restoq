// Språk på restoq.no: norsk (original), engelsk, tysk, polsk og spansk.
// Tekstene byttes ut i nettleseren (public/restoq-i18n.js) med ordbøkene i public/i18n/<språk>.json.
// Rettelser fra Utvikler → Oversettelser lagres i databasen og går foran filene.
import { cookies } from "next/headers";

export const UI_LANGS = [
  { id: "nb", label: "Norsk", short: "NO", mt: "Norwegian Bokmål" },
  { id: "en", label: "English", short: "EN", mt: "British English" },
  { id: "de", label: "Deutsch", short: "DE", mt: "German" },
  { id: "pl", label: "Polski", short: "PL", mt: "Polish" },
  { id: "es", label: "Español", short: "ES", mt: "European Spanish" },
] as const;
export type UiLang = (typeof UI_LANGS)[number]["id"];
export const LANG_COOKIE = "restoq_lang";
export const isUiLang = (v: unknown): v is UiLang => UI_LANGS.some((l) => l.id === v);
export const OTHER_LANGS = UI_LANGS.filter((l) => l.id !== "nb");

export async function getUiLang(): Promise<UiLang> {
  try {
    const v = (await cookies()).get(LANG_COOKIE)?.value;
    return isUiLang(v) ? v : "nb";
  } catch {
    return "nb";
  }
}
