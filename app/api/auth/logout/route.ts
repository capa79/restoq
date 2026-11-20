import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { destroySession, getCurrentUser, sameOrigin } from "@/lib/session";

export async function POST(req: NextRequest) {
  if (!(await sameOrigin(req))) return NextResponse.json({ error: "Ugyldig opphav." }, { status: 403 });
  // Ansatte sendes tilbake til stedets egen side, andre til vanlig innlogging
  const me = await getCurrentUser().catch(() => null);
  const slug = me?.org_id && me.role !== "admin" ? (await (await db()).query("SELECT slug FROM orgs WHERE id = $1", [me.org_id])).rows[0]?.slug : null;
  await destroySession();
  return NextResponse.redirect(new URL(slug ? `/v/${slug}?ut=1` : "/login?ut=1", req.url), 303);
}
