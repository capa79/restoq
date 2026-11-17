import { NextRequest, NextResponse } from "next/server";
import { destroySession, sameOrigin } from "@/lib/session";

export async function POST(req: NextRequest) {
  if (!(await sameOrigin(req))) return NextResponse.json({ error: "Ugyldig opphav." }, { status: 403 });
  await destroySession();
  return NextResponse.redirect(new URL("/login?ut=1", req.url), 303);
}
