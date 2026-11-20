import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u?.is_developer) return new Response("Ikke tilgang", { status: 403 });
  const id = Number((await ctx.params).id);
  if (!Number.isSafeInteger(id)) return new Response("Ugyldig", { status: 400 });
  const r = (await (await db()).query("SELECT mime, data FROM feedback_images WHERE id = $1", [id])).rows[0];
  if (!r) return new Response("Fant ikke bildet", { status: 404 });
  return new Response(new Uint8Array(r.data), { headers: { "Content-Type": r.mime, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" } });
}
