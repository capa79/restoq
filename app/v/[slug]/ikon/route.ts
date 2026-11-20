import sharp from "sharp";
import { dataUrlBuffer, parseColor } from "@/lib/brand";
import { getVenue } from "@/lib/venue";

// App-ikon for «Legg til på hjemskjerm»: logoen på stedets farge. ?s=192|512, ?m=1 gir maskable (mer luft).
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const v = await getVenue((await ctx.params).slug);
  if (!v) return new Response("Ikke funnet", { status: 404 });
  const u = new URL(req.url);
  const size = u.searchParams.get("s") === "192" ? 192 : u.searchParams.get("s") === "180" ? 180 : 512;
  const pad = u.searchParams.get("m") === "1" ? 0.24 : 0.14;
  const [r, g, b] = parseColor(v.brand.head) ?? [20, 26, 24];
  const base = sharp({ create: { width: size, height: size, channels: 4, background: { r, g, b, alpha: 1 } } });
  let png: Buffer;
  if (v.brand.logo) {
    const inner = Math.round(size * (1 - pad * 2));
    const logo = await sharp(dataUrlBuffer(v.brand.logo), { density: 300 }).resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    png = await base.composite([{ input: logo, gravity: "center" }]).png().toBuffer();
  } else {
    const ink = r * 0.299 + g * 0.587 + b * 0.114 > 160 ? "#141A18" : "#FFFFFF";
    const letter = (v.name.trim()[0] ?? "R").toUpperCase().replace(/[<>&"]/g, "");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="${size * 0.5}" fill="${ink}">${letter}</text></svg>`;
    png = await base.composite([{ input: Buffer.from(svg) }]).png().toBuffer();
  }
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" } });
}
