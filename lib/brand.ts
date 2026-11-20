// Whitelabel: henter profil fra kundens logo og hjemmeside.
// Hjemmesiden hentes på serveren med vern mot SSRF: bare http/https på port 80/443, og hver
// DNS-oppslag sjekkes mot private/interne adresser i selve tilkoblingen (hindrer DNS-rebinding).
import dns from "node:dns";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import sharp from "sharp";
import { db } from "./db";

export type Brand = {
  head: string; accent: string; logo: string | null;
  name?: string; tagline?: string; website?: string; hero?: number; palette?: string[];
  font?: string; source?: { themeColor?: string; title?: string; logoFrom?: string; fetchedAt?: string; error?: string };
};
export const BRAND_DEFAULT: Brand = { head: "#141A18", accent: "#D2372B", logo: null };

// ---------- trygg henting ----------
function privateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return privateIp(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff");
}
const safeLookup: net.LookupFunction = (host, opts, cb) => {
  dns.lookup(host, { ...opts, all: true }, (err, addrs) => {
    if (err) return cb(err, "", 4);
    const list = (addrs as dns.LookupAddress[]).filter((a) => !privateIp(a.address));
    if (!list.length) return cb(new Error("Adressen peker til et internt nett og hentes ikke."), "", 4);
    if ((opts as { all?: boolean }).all) return (cb as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    cb(null, list[0].address, list[0].family);
  });
};

export class FetchError extends Error {}
type Got = { url: string; type: string; body: Buffer };

export async function safeFetch(raw: string, maxBytes = 2_000_000, redirects = 4): Promise<Got> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new FetchError("Ugyldig adresse."); }
  if (!["http:", "https:"].includes(u.protocol)) throw new FetchError("Bare http- og https-adresser kan hentes.");
  if (u.port && !["80", "443"].includes(u.port)) throw new FetchError("Bare vanlige nettadresser (port 80/443) kan hentes.");
  if (u.username || u.password) throw new FetchError("Adressen kan ikke inneholde brukernavn eller passord.");
  if (net.isIP(u.hostname.replace(/^\[|\]$/g, "")) && privateIp(u.hostname.replace(/^\[|\]$/g, ""))) throw new FetchError("Adressen peker til et internt nett og hentes ikke.");
  const lib = u.protocol === "https:" ? https : http;
  return new Promise<Got>((resolve, reject) => {
    const req = lib.get(u, {
      lookup: safeLookup, timeout: 8000,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RestoqBot/1.0; +https://restoq.no)", Accept: "text/html,text/css,image/*;q=0.9,*/*;q=0.5", "Accept-Encoding": "gzip, deflate, br", "Accept-Language": "nb,no;q=0.9,en;q=0.7" },
    }, (res) => {
      const code = res.statusCode ?? 0;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new FetchError("For mange videresendinger."));
        return resolve(safeFetch(new URL(res.headers.location, u).toString(), maxBytes, redirects - 1));
      }
      if (code >= 400) { res.resume(); return reject(new FetchError(`Nettstedet svarte med feil ${code}.`)); }
      const enc = String(res.headers["content-encoding"] ?? "");
      const stream = enc.includes("br") ? res.pipe(zlib.createBrotliDecompress()) : enc.includes("gzip") ? res.pipe(zlib.createGunzip()) : enc.includes("deflate") ? res.pipe(zlib.createInflate()) : res;
      const chunks: Buffer[] = []; let n = 0;
      stream.on("data", (c: Buffer) => { n += c.length; if (n > maxBytes) { req.destroy(); stream.destroy(); reject(new FetchError("Filen er for stor.")); } else chunks.push(c); });
      stream.on("end", () => resolve({ url: u.toString(), type: String(res.headers["content-type"] ?? "").toLowerCase(), body: Buffer.concat(chunks) }));
      stream.on("error", () => reject(new FetchError("Kunne ikke lese svaret.")));
    });
    req.on("timeout", () => req.destroy(new FetchError("Nettstedet svarte ikke innen 8 sekunder.")));
    req.on("error", (e) => reject(e instanceof FetchError ? e : new FetchError(e.message.includes("internt nett") ? e.message : "Fant ikke nettstedet. Sjekk adressen.")));
  });
}

export function normalizeUrl(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  try { const u = new URL(/^https?:\/\//i.test(t) ? t : "https://" + t); return u.hostname.includes(".") ? u.toString() : null; } catch { return null; }
}

// ---------- farger ----------
type RGB = [number, number, number];
const hex = (c: RGB) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
export function parseColor(s: string): RGB | null {
  const t = s.trim().toLowerCase();
  let m = t.match(/^#([0-9a-f]{3,8})$/);
  if (m) { let h = m[1]; if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split("").map((x) => x + x).join(""); if (h.length < 6) return null; return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB; }
  m = t.match(/^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}
const lum = ([r, g, b]: RGB) => 0.299 * r + 0.587 * g + 0.114 * b;
const sat = ([r, g, b]: RGB) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx ? (mx - mn) / mx : 0; };
const dist = (a: RGB, b: RGB) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
export const inkFor = (h: string) => (lum(parseColor(h) ?? [0, 0, 0]) > 160 ? "#141A18" : "#FFFFFF");

type Swatch = { c: RGB; w: number };
/** Vanligste farger i et bilde (ignorerer gjennomsiktig og nesten hvitt). */
export async function imageColors(buf: Buffer): Promise<{ swatches: Swatch[]; avgLum: number; opaque: number }> {
  const { data } = await sharp(buf, { density: 96 }).resize(64, 64, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bins = new Map<number, Swatch>(); let lsum = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const c: RGB = [data[i], data[i + 1], data[i + 2]]; n++; lsum += lum(c);
    const k = ((c[0] >> 4) << 8) | ((c[1] >> 4) << 4) | (c[2] >> 4);
    const s = bins.get(k); if (s) { s.w++; s.c = [(s.c[0] * (s.w - 1) + c[0]) / s.w, (s.c[1] * (s.w - 1) + c[1]) / s.w, (s.c[2] * (s.w - 1) + c[2]) / s.w]; } else bins.set(k, { c, w: 1 });
  }
  return { swatches: [...bins.values()].sort((a, b) => b.w - a.w), avgLum: n ? lsum / n : 255, opaque: n / (data.length / 4) };
}

/** Farger brukt i CSS (bakgrunn, tekst, knapper, egne variabler som --primary). */
function cssColors(css: string): Swatch[] {
  const m = new Map<string, Swatch>();
  const add = (s: string, w: number) => { const c = parseColor(s); if (!c) return; const k = hex(c); const o = m.get(k); if (o) o.w += w; else m.set(k, { c, w }); };
  for (const x of css.matchAll(/--[\w-]*(primary|brand|accent|main|theme|color-1|secondary)[\w-]*\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]+\))/gi)) add(x[2], 12);
  for (const x of css.matchAll(/(background(?:-color)?|color|border(?:-color)?|fill)\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]+\))/gi)) add(x[2], x[1].startsWith("background") ? 2 : 1);
  return [...m.values()].sort((a, b) => b.w - a.w);
}

/** Velger topplinjefarge og aksentfarge slik at logoen alltid synes på topplinjen. */
export function pickColors(logo: { swatches: Swatch[]; avgLum: number; opaque?: number } | null, site: Swatch[], themeColor: RGB | null): { head: string; accent: string; palette: string[] } {
  const all: Swatch[] = [...(logo?.swatches ?? []).map((s) => ({ c: s.c, w: s.w * 3 })), ...site];
  if (themeColor) all.unshift({ c: themeColor, w: 50 });
  const visible = all.filter((s) => lum(s.c) < 238 && lum(s.c) > 14);
  const badge = logo && (logo.opaque ?? 0) > 0.85 ? logo.swatches[0]?.c : null; // logoen har egen bakgrunn
  const logoDark = logo && !badge ? logo.avgLum < 110 : false;
  const logoLight = logo ? logo.avgLum > 200 : false;
  let head: RGB;
  if (badge) head = badge; // topplinjen får logoens bakgrunnsfarge, så den glir sømløst inn
  else if (logoDark) head = [255, 255, 255]; // mørk, gjennomsiktig logo: lys topplinje
  else {
    const dark = visible.filter((s) => lum(s.c) < 95).sort((a, b) => b.w - a.w)[0]?.c;
    const tc = themeColor && lum(themeColor) < 140 ? themeColor : null;
    head = tc ?? dark ?? (logoLight ? [20, 26, 24] : [20, 26, 24]);
  }
  const accentC = visible.filter((s) => sat(s.c) > 0.35 && lum(s.c) > 45 && dist(s.c, head) > 90).sort((a, b) => Math.sqrt(b.w) * sat(b.c) ** 2 - Math.sqrt(a.w) * sat(a.c) ** 2)[0]?.c ?? (themeColor && dist(themeColor, head) > 90 ? themeColor : null);
  const palette: string[] = [];
  for (const s of visible) { if (palette.length >= 8) break; if (palette.every((p) => dist(parseColor(p)!, s.c) > 60)) palette.push(hex(s.c)); }
  return { head: hex(head), accent: accentC ? hex(accentC) : BRAND_DEFAULT.accent, palette };
}

// ---------- bilder ----------
const IMG_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml", "image/gif", "image/x-icon", "image/vnd.microsoft.icon", "image/avif"];
function isSvg(buf: Buffer) { const h = buf.subarray(0, 600).toString("utf8").trimStart().toLowerCase(); return h.startsWith("<svg") || (h.startsWith("<?xml") && h.includes("<svg")); }

/** Logo til data-URL: SVG beholdes (renset), rasterbilder skaleres til maks 600 px PNG. */
export async function logoDataUrl(buf: Buffer): Promise<string> {
  if (isSvg(buf)) {
    if (buf.length > 300_000) throw new Error("SVG-logoen er større enn 300 kB.");
    const clean = buf.toString("utf8").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, "").replace(/(href\s*=\s*["'])\s*javascript:[^"']*/gi, "$1#");
    await sharp(Buffer.from(clean)).metadata(); // feiler hvis den ikke er en gyldig SVG
    return "data:image/svg+xml;base64," + Buffer.from(clean).toString("base64");
  }
  const png = await sharp(buf, { animated: false }).trim({ threshold: 4 }).resize(600, 600, { fit: "inside", withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
  return "data:image/png;base64," + png.toString("base64");
}
export const dataUrlBuffer = (d: string) => Buffer.from(d.split(",")[1] ?? "", "base64");

// ---------- hjemmesiden ----------
const attr = (tag: string, a: string) => tag.match(new RegExp(`\\s${a}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"))?.slice(2).find((x) => x != null)?.trim() ?? "";
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/\s+/g, " ").trim();

export type SiteInfo = { url: string; title: string; siteName: string; description: string; themeColor: RGB | null; logoUrls: string[]; heroUrl: string | null; css: Swatch[]; font: string };

export async function readSite(url: string): Promise<SiteInfo> {
  const page = await safeFetch(url, 3_000_000);
  if (!page.type.includes("html")) throw new FetchError("Adressen er ikke en nettside.");
  const html = page.body.toString("utf8");
  const head = html.slice(0, 400_000);
  const abs = (h: string) => { try { return h ? new URL(decode(h), page.url).toString() : ""; } catch { return ""; } };
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const meta = (k: string) => decode(attr(metas.find((t) => [attr(t, "name"), attr(t, "property")].some((v) => v.toLowerCase() === k)) ?? "", "content"));
  const links = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);

  const logoUrls: string[] = [];
  // 1) <img> som er merket som logo (helst i toppen av siden)
  for (const t of imgs.slice(0, 80)) {
    const blob = (attr(t, "class") + " " + attr(t, "id") + " " + attr(t, "alt") + " " + attr(t, "src")).toLowerCase();
    const src = attr(t, "src") || attr(t, "data-src") || attr(t, "srcset").split(/[ ,]/)[0];
    if (/logo|brand/.test(blob) && src && !src.startsWith("data:")) logoUrls.push(abs(src));
  }
  // 2) apple-touch-icon / største ikon
  const icons = links.filter((t) => /icon/i.test(attr(t, "rel"))).map((t) => ({ href: abs(attr(t, "href")), size: Number(attr(t, "sizes").split("x")[0]) || (/apple/i.test(attr(t, "rel")) ? 180 : /svg/.test(attr(t, "type") + attr(t, "href")) ? 512 : 32) })).sort((a, b) => b.size - a.size);
  for (const i of icons) if (i.size >= 120 && i.href) logoUrls.push(i.href);
  const og = meta("og:image") || meta("twitter:image");

  // CSS: inline og de to første stilarkene på samme nettsted
  let css = [...head.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n") + "\n" + [...html.matchAll(/\sstyle\s*=\s*"([^"]*)"/gi)].slice(0, 300).map((m) => m[1]).join(";");
  const host = new URL(page.url).hostname.replace(/^www\./, "");
  const sheets = links.filter((t) => /stylesheet/i.test(attr(t, "rel"))).map((t) => abs(attr(t, "href"))).filter((h) => { try { return new URL(h).hostname.replace(/^www\./, "").endsWith(host); } catch { return false; } }).slice(0, 3);
  for (const s of sheets) { try { css += "\n" + (await safeFetch(s, 1_500_000)).body.toString("utf8"); } catch { /* hopp over */ } }
  const gfont = links.map((t) => attr(t, "href")).find((h) => h.includes("fonts.googleapis.com"));
  const font = gfont ? decodeURIComponent(gfont.match(/family=([^:&;]+)/)?.[1] ?? "").replace(/\+/g, " ") : (css.match(/font-family\s*:\s*["']?([A-Za-z][\w -]{2,40})["']?\s*[,;]/)?.[1] ?? "");

  return {
    url: page.url,
    title: decode(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""),
    siteName: meta("og:site_name") || meta("application-name"),
    description: meta("og:description") || meta("description") || meta("twitter:description"),
    themeColor: parseColor(meta("theme-color") || meta("msapplication-tilecolor")),
    logoUrls: [...new Set(logoUrls.filter(Boolean))].slice(0, 6),
    heroUrl: og ? abs(og) : null,
    css: cssColors(css),
    font: font.trim(),
  };
}

async function fetchImage(url: string, max = 4_000_000): Promise<Buffer | null> {
  try {
    const r = await safeFetch(url, max);
    if (!IMG_TYPES.some((t) => r.type.startsWith(t)) && !isSvg(r.body) && !/^image\//.test(r.type)) return null;
    await sharp(r.body, { density: 96 }).metadata();
    return r.body;
  } catch { return null; }
}

// ---------- alt samlet ----------
export type BuildInput = { name: string; website?: string | null; logo?: Buffer | null; useSiteImages: boolean };
export type Built = { brand: Brand; hero: Buffer | null; notes: string[] };

/** Lager whitelabel-profilen fra logo og hjemmeside. Feiler aldri – manglende data gir standardverdier og en merknad. */
export async function buildBrand(inp: BuildInput): Promise<Built> {
  const notes: string[] = [];
  let site: SiteInfo | null = null;
  if (inp.website) {
    try { site = await readSite(inp.website); } catch (e) { notes.push(`Hjemmesiden kunne ikke leses: ${e instanceof Error ? e.message : "ukjent feil"}`); }
  }
  let logoBuf: Buffer | null = null; let logoFrom = "";
  if (inp.logo?.length) { logoBuf = inp.logo; logoFrom = "opplastet"; }
  else if (site && inp.useSiteImages) {
    for (const u of site.logoUrls) { const b = await fetchImage(u, 1_500_000); if (b) { logoBuf = b; logoFrom = u; break; } }
    if (!logoBuf) notes.push("Fant ingen logo på hjemmesiden. Last opp logoen.");
  }
  let logo: string | null = null; let logoColors: Awaited<ReturnType<typeof imageColors>> | null = null;
  if (logoBuf) {
    try { logo = await logoDataUrl(logoBuf); logoColors = await imageColors(dataUrlBuffer(logo)); }
    catch (e) { notes.push(`Logoen kunne ikke brukes: ${e instanceof Error ? e.message : "ukjent format"}`); logo = null; }
  }
  const colors = pickColors(logoColors, site?.css ?? [], site?.themeColor ?? null);
  let hero: Buffer | null = null;
  if (site?.heroUrl && inp.useSiteImages) {
    const b = await fetchImage(site.heroUrl, 8_000_000);
    if (b) hero = await sharp(b).resize(1600, 1000, { fit: "cover", withoutEnlargement: true }).jpeg({ quality: 72, mozjpeg: true }).toBuffer().catch(() => null);
  }
  const tagline = (site?.description ?? "").slice(0, 220);
  return {
    brand: {
      ...colors, logo, name: inp.name, tagline, website: site?.url ?? inp.website ?? undefined, font: site?.font || undefined,
      source: { themeColor: site?.themeColor ? hex(site.themeColor) : undefined, title: site?.siteName || site?.title || undefined, logoFrom: logoFrom || undefined, fetchedAt: new Date().toISOString(), error: notes[0] },
    },
    hero, notes,
  };
}

// ---------- lagring ----------
export function slugify(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/æ/g, "ae").replace(/ø/g, "o").replace(/å/g, "a").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "sted";
}
export async function uniqueSlug(base: string, orgId?: number) {
  const p = await db(); let s = slugify(base); let i = 1;
  const reserved = ["admin", "app", "api", "login", "ny", "demo"];
  while (reserved.includes(s) || (await p.query("SELECT 1 FROM orgs WHERE slug = $1 AND id <> $2", [s, orgId ?? 0])).rowCount) s = `${slugify(base).slice(0, 36)}-${++i}`;
  return s;
}
export async function getBrand(orgId: number): Promise<Brand> {
  const r = (await (await db()).query("SELECT data FROM docs WHERE org_id = $1 AND col = 'config' AND id = 'brand'", [orgId])).rows[0];
  return { ...BRAND_DEFAULT, ...(r?.data ?? {}) };
}
export async function saveHero(orgId: number, img: Buffer | null) {
  const p = await db();
  await p.query("DELETE FROM files WHERE org_id = $1 AND id = 'brand-hero'", [orgId]);
  if (img) await p.query("INSERT INTO files (org_id, id, name, mime, size, data) VALUES ($1, 'brand-hero', 'forsidebilde.jpg', 'image/jpeg', $2, $3)", [orgId, img.length, img]);
}
