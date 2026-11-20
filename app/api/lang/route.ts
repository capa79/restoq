import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isUiLang, LANG_COOKIE } from "@/lib/i18n";
import { getCurrentUser, safeNext } from "@/lib/session";

// /api/lang?l=en&next=/app – velger språk (huskes i et år, og på kontoen hvis du er logget inn)
export async function GET(req: NextRequest) {
  const l = req.nextUrl.searchParams.get("l");
  let ref = "/";
  try {
    const r = new URL(req.headers.get("referer") ?? "");
    if (r.host === req.nextUrl.host) ref = r.pathname + r.search;
  } catch {}
  const next = safeNext(req.nextUrl.searchParams.get("next") ?? ref, "/");
  const res = NextResponse.redirect(new URL(next, req.url), 303);
  if (isUiLang(l)) {
    res.cookies.set(LANG_COOKIE, l, { httpOnly: false, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
    const u = await getCurrentUser().catch(() => null);
    if (u) await (await db()).query("UPDATE users SET ui_lang = $2 WHERE id = $1", [u.id, l]).catch(() => {});
  }
  return res;
}
