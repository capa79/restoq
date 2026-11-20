import { getVenue } from "@/lib/venue";

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const v = await getVenue((await ctx.params).slug);
  if (!v) return new Response("Ikke funnet", { status: 404 });
  const base = `/v/${v.slug}`;
  const m = {
    name: `${v.name} – lager og bestilling`, short_name: v.name.slice(0, 12), id: base, start_url: `${base}?app=1`, scope: "/", display: "standalone",
    background_color: v.brand.head, theme_color: v.brand.head, lang: "nb",
    icons: [
      { src: `${base}/ikon?s=192&v=${v.brand.source?.fetchedAt ?? ""}`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${base}/ikon?s=512&v=${v.brand.source?.fetchedAt ?? ""}`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `${base}/ikon?s=512&m=1`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return new Response(JSON.stringify(m), { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=600" } });
}
