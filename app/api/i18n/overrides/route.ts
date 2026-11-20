import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isUiLang } from "@/lib/i18n";

// Rettelser fra utviklersiden for ett språk (går foran ordbokfilene)
export async function GET(req: Request) {
  const lang = new URL(req.url).searchParams.get("lang");
  if (!isUiLang(lang) || lang === "nb") return NextResponse.json({});
  try {
    const r = await (await db()).query("SELECT source, text FROM i18n_overrides WHERE lang = $1", [lang]);
    return NextResponse.json(Object.fromEntries(r.rows.map((x) => [x.source, x.text])), { headers: { "Cache-Control": "public, max-age=60" } });
  } catch {
    return NextResponse.json({});
  }
}
