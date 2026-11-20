import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isUiLang } from "@/lib/i18n";
import { sameOrigin } from "@/lib/session";

// Nettleseren melder fra om tekster som manglet oversettelse. Vises under Utvikler → Oversettelser.
const hits = new Map<string, number[]>();
export async function POST(req: Request) {
  if (!(await sameOrigin(req))) return NextResponse.json({ ok: false }, { status: 403 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "ukjent";
  const now = Date.now();
  const l = (hits.get(ip) ?? []).filter((t) => now - t < 600_000);
  if (l.length >= 30) return NextResponse.json({ ok: false }, { status: 429 });
  l.push(now);
  hits.set(ip, l);
  const b = await req.json().catch(() => ({}));
  if (!isUiLang(b.lang) || b.lang === "nb" || !Array.isArray(b.strings)) return NextResponse.json({ ok: false }, { status: 400 });
  const path = String(b.path ?? "").split("?")[0].slice(0, 200);
  const strings = [...new Set((b.strings as unknown[]).map((s) => String(s).replace(/\s+/g, " ").trim()).filter((s) => s.length >= 2 && s.length <= 400 && /\p{L}/u.test(s)))].slice(0, 100);
  const p = await db();
  const count = Number((await p.query("SELECT count(*)::int AS n FROM i18n_missing WHERE lang = $1", [b.lang])).rows[0].n);
  for (const s of strings) {
    await p.query(
      `INSERT INTO i18n_missing (lang, source, path) SELECT $1, $2, $3 WHERE $4 < 3000 OR EXISTS (SELECT 1 FROM i18n_missing WHERE lang = $1 AND source = $2)
       ON CONFLICT (lang, source) DO UPDATE SET hits = i18n_missing.hits + 1, last_seen = now(), path = EXCLUDED.path`,
      [b.lang, s, path, count]
    );
  }
  return NextResponse.json({ ok: true });
}
