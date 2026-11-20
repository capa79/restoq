import { NextResponse } from "next/server";
import { logError } from "@/lib/error-log";
import { getCurrentUser, sameOrigin } from "@/lib/session";

// Tar imot feil fra nettleseren. Høyst 20 per IP-adresse per 10 minutter.
const hits = new Map<string, number[]>();

export async function POST(req: Request) {
  if (!(await sameOrigin(req))) return NextResponse.json({ ok: false }, { status: 403 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "ukjent";
  const now = Date.now();
  const l = (hits.get(ip) ?? []).filter((t) => now - t < 600_000);
  if (l.length >= 20) return NextResponse.json({ ok: false }, { status: 429 });
  l.push(now);
  hits.set(ip, l);
  const b = await req.json().catch(() => ({}));
  const u = await getCurrentUser().catch(() => null);
  await logError({ source: "client", message: String(b.message ?? ""), stack: String(b.stack ?? ""), path: String(b.path ?? ""), userAgent: req.headers.get("user-agent") ?? "", orgId: u?.org_id ?? null, userId: u?.id ?? null });
  return NextResponse.json({ ok: true });
}
