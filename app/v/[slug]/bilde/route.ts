import { db } from "@/lib/db";
import { getVenue } from "@/lib/venue";

// Forsidebildet hentet fra stedets hjemmeside (lagret som JPEG, maks 1600 px).
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const v = await getVenue((await ctx.params).slug);
  if (!v?.hasHero) return new Response("Ikke funnet", { status: 404 });
  const r = (await (await db()).query("SELECT data FROM files WHERE org_id = $1 AND id = 'brand-hero'", [v.id])).rows[0];
  if (!r) return new Response("Ikke funnet", { status: 404 });
  return new Response(new Uint8Array(r.data), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600" } });
}
